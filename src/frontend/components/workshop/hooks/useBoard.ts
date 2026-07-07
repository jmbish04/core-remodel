// ---------------------------------------------------------------------------
// useBoard — the Workshop's central client state.
//
// Owns the board (nodes/collections/clippings), optimistic node moves with a
// per-node ~500ms debounced PATCH, collection membership, clipping extraction,
// and recipe execution state. Recipes are sync-201: while the POST is in flight
// the SOURCE node is flagged "processing" (ambient + narration overlay); on the
// 201 response the finished CHILD node is inserted from the body (no refetch)
// and flagged for a staggered reveal.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import * as api from "../api";
import type {
  Board,
  BoardNode,
  Clipping,
  Collection,
  NodeSourceType,
} from "../types";

const POSITION_DEBOUNCE_MS = 500;

export interface UseBoardResult {
  loading: boolean;
  error: string | null;
  board: Board | null;
  nodes: BoardNode[];
  collections: Collection[];
  clippings: Clipping[];
  /** Source node ids with a recipe HTTP request currently in flight. */
  processingNodeIds: Set<string>;
  /** Child node ids added this session (drives the staggered reveal). */
  justAddedNodeIds: Set<string>;
  reload: () => Promise<void>;
  addNode: (input: api.CreateNodeInput) => Promise<BoardNode | null>;
  /** Optimistic local move; a debounced PATCH persists x/y (and size). */
  moveNode: (id: string, patch: { x?: number; y?: number; width?: number; height?: number }) => void;
  patchNode: (id: string, patch: api.PatchNodeInput) => Promise<void>;
  removeNode: (id: string) => Promise<void>;
  // Collections
  createCollection: (name?: string) => Promise<Collection | null>;
  renameCollection: (id: string, name: string) => Promise<void>;
  removeCollection: (id: string) => Promise<void>;
  addItemToCollection: (
    collectionId: string,
    input: { cfImageUrl: string; sourceType: NodeSourceType; sourceId?: string },
  ) => Promise<void>;
  removeItemFromCollection: (collectionId: string, itemId: string) => Promise<void>;
  // Clippings
  registerClipping: (clipping: Clipping) => void;
  // Recipe execution (sync-201)
  /** Flag/unflag a source node as having a recipe in flight. */
  setNodeProcessing: (nodeId: string, processing: boolean) => void;
  /** Insert a finished child node (from the 201 body) with a reveal flag. */
  insertChildNode: (node: BoardNode) => void;
}

export function useBoard(roomId: string): UseBoardResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [nodes, setNodes] = useState<BoardNode[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [clippings, setClippings] = useState<Clipping[]>([]);
  const [processingNodeIds, setProcessingNodeIds] = useState<Set<string>>(
    new Set(),
  );
  const [justAddedNodeIds, setJustAddedNodeIds] = useState<Set<string>>(
    new Set(),
  );

  // Per-node debounce timers for position/size saves.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const latestPatchRef = useRef<Map<string, api.PatchNodeInput>>(new Map());
  const revealTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const reload = useCallback(async () => {
    try {
      setError(null);
      const data = await api.getBoard(roomId);
      setBoard(data.board);
      setNodes(data.nodes);
      setCollections(data.collections);
      setClippings(data.clippings);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load the board";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  // Flush all pending debounced saves + reveal timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    const reveals = revealTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const timer of reveals.values()) clearTimeout(timer);
      reveals.clear();
    };
  }, []);

  const flushNodePatch = useCallback((id: string) => {
    const patch = latestPatchRef.current.get(id);
    if (!patch) return;
    latestPatchRef.current.delete(id);
    api.patchNode(id, patch).catch((err) => {
      toast.error(
        err instanceof Error ? err.message : "Couldn't save that move",
      );
    });
  }, []);

  const moveNode = useCallback(
    (
      id: string,
      patch: { x?: number; y?: number; width?: number; height?: number },
    ) => {
      // Optimistic local update.
      setNodes((prev) =>
        prev.map((node) => (node.id === id ? { ...node, ...patch } : node)),
      );
      // Merge into the latest debounced patch.
      const merged = { ...(latestPatchRef.current.get(id) ?? {}), ...patch };
      latestPatchRef.current.set(id, merged);
      const existing = timersRef.current.get(id);
      if (existing) clearTimeout(existing);
      timersRef.current.set(
        id,
        setTimeout(() => {
          timersRef.current.delete(id);
          flushNodePatch(id);
        }, POSITION_DEBOUNCE_MS),
      );
    },
    [flushNodePatch],
  );

  const addNode = useCallback(
    async (input: api.CreateNodeInput): Promise<BoardNode | null> => {
      if (!board) return null;
      try {
        const node = await api.createNode(board.id, input);
        setNodes((prev) => [...prev, node]);
        return node;
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't add that to the board",
        );
        return null;
      }
    },
    [board],
  );

  const patchNode = useCallback(
    async (id: string, patch: api.PatchNodeInput) => {
      // Optimistic.
      setNodes((prev) =>
        prev.map((node) => (node.id === id ? { ...node, ...patch } : node)),
      );
      try {
        const node = await api.patchNode(id, patch);
        setNodes((prev) => prev.map((n) => (n.id === id ? node : n)));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't update node");
        void reload();
      }
    },
    [reload],
  );

  const removeNode = useCallback(async (id: string) => {
    setNodes((prev) => prev.filter((node) => node.id !== id));
    try {
      await api.deleteNode(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete node");
      void reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createCollection = useCallback(
    async (name?: string): Promise<Collection | null> => {
      if (!board) return null;
      try {
        const collection = await api.createCollection(board.id, name);
        setCollections((prev) => [...prev, collection]);
        return collection;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't make a pile");
        return null;
      }
    },
    [board],
  );

  const renameCollection = useCallback(async (id: string, name: string) => {
    setCollections((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name } : c)),
    );
    try {
      await api.patchCollection(id, { name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't rename pile");
    }
  }, []);

  const removeCollection = useCallback(async (id: string) => {
    setCollections((prev) => prev.filter((c) => c.id !== id));
    try {
      await api.deleteCollection(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove pile");
    }
  }, []);

  const addItemToCollection = useCallback(
    async (
      collectionId: string,
      input: { cfImageUrl: string; sourceType: NodeSourceType; sourceId?: string },
    ) => {
      try {
        const items = await api.addCollectionItem(collectionId, input);
        setCollections((prev) =>
          prev.map((c) => (c.id === collectionId ? { ...c, items } : c)),
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't add to the pile",
        );
      }
    },
    [],
  );

  const removeItemFromCollection = useCallback(
    async (collectionId: string, itemId: string) => {
      try {
        const items = await api.deleteCollectionItem(collectionId, itemId);
        setCollections((prev) =>
          prev.map((c) => (c.id === collectionId ? { ...c, items } : c)),
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't remove from the pile",
        );
      }
    },
    [],
  );

  const registerClipping = useCallback((clipping: Clipping) => {
    setClippings((prev) => [clipping, ...prev]);
  }, []);

  const setNodeProcessing = useCallback(
    (nodeId: string, processing: boolean) => {
      setProcessingNodeIds((prev) => {
        const next = new Set(prev);
        if (processing) next.add(nodeId);
        else next.delete(nodeId);
        return next;
      });
    },
    [],
  );

  const insertChildNode = useCallback((node: BoardNode) => {
    setNodes((prev) =>
      prev.some((n) => n.id === node.id)
        ? prev.map((n) => (n.id === node.id ? node : n))
        : [...prev, node],
    );
    // Flag for the staggered reveal, then clear the flag after the entrance so
    // it doesn't re-animate on later re-renders.
    setJustAddedNodeIds((prev) => new Set(prev).add(node.id));
    const timer = setTimeout(() => {
      setJustAddedNodeIds((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
      revealTimers.current.delete(timer);
    }, 700);
    revealTimers.current.add(timer);
  }, []);

  return useMemo(
    () => ({
      loading,
      error,
      board,
      nodes,
      collections,
      clippings,
      processingNodeIds,
      justAddedNodeIds,
      reload,
      addNode,
      moveNode,
      patchNode,
      removeNode,
      createCollection,
      renameCollection,
      removeCollection,
      addItemToCollection,
      removeItemFromCollection,
      registerClipping,
      setNodeProcessing,
      insertChildNode,
    }),
    [
      loading,
      error,
      board,
      nodes,
      collections,
      clippings,
      processingNodeIds,
      justAddedNodeIds,
      reload,
      addNode,
      moveNode,
      patchNode,
      removeNode,
      createCollection,
      renameCollection,
      removeCollection,
      addItemToCollection,
      removeItemFromCollection,
      registerClipping,
      setNodeProcessing,
      insertChildNode,
    ],
  );
}
