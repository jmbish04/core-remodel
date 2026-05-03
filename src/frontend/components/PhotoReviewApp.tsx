import { Upload, X, Check, Search, Tag, FileImage, Home, RefreshCw } from "lucide-react";
import React, { useState, useEffect, useRef } from "react";

interface ImageRecord {
  id: string;
  path: string;
  filename: string;
  room: string;
  tags: string | string[]; // comes as stringified JSON from API
  note: string;
  sourceFile?: string;
  imageNumber?: string;
  igAccount?: string;
  visibleCaption?: string;
  width?: number;
  height?: number;
}

interface ImageGroup {
  room: string;
  images: ImageRecord[];
}

export function PhotoReviewApp() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [groups, setGroups] = useState<ImageGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);

  // Panel form state
  const [panelRoom, setPanelRoom] = useState("");
  const [panelTags, setPanelTags] = useState("");
  const [panelNote, setPanelNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchImages = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/photo-reviews");
      const data = (await res.json()) as { images?: ImageRecord[]; groups?: ImageGroup[] };
      if (data.images && data.groups) {
        setImages(data.images);
        setGroups(data.groups);
      }
    } catch (err) {
      console.error("Failed to fetch images:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, []);

  useEffect(() => {
    if (selectedImage) {
      setPanelRoom(selectedImage.room || "unassigned");
      let t = selectedImage.tags;
      if (typeof t === "string") {
        try {
          t = JSON.parse(t);
        } catch {
          t = [];
        }
      }
      setPanelTags(Array.isArray(t) ? t.join(", ") : "");
      setPanelNote(selectedImage.note || "");
    }
  }, [selectedImage]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const file = e.target.files[0];
    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    try {
      const res = await fetch("/api/photo-reviews/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as { success?: boolean; image?: ImageRecord; error?: string };
      if (data.success) {
        await fetchImages();
        if (data.image) setSelectedImage(data.image);
      } else {
        alert(data.error || "Failed to upload");
      }
    } catch (err) {
      console.error("Upload error:", err);
      alert("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const saveSelectedImage = async () => {
    if (!selectedImage) return;

    setIsSaving(true);

    // Parse tags back into array
    const tagArray = panelTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const res = await fetch(`/api/photo-reviews/${selectedImage.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          room: panelRoom,
          tags: tagArray,
          note: panelNote,
        }),
      });

      const data = (await res.json()) as { success?: boolean; image?: ImageRecord };
      if (data.success) {
        await fetchImages();
        if (data.image) setSelectedImage(data.image);
      }
    } catch (err) {
      console.error("Save error:", err);
      alert("Failed to save metadata");
    } finally {
      setIsSaving(false);
    }
  };

  // Helper to parse tags
  const getTags = (tagsRaw: string | string[]): string[] => {
    if (Array.isArray(tagsRaw)) return tagsRaw;
    if (typeof tagsRaw === "string") {
      try {
        const parsed = JSON.parse(tagsRaw);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return [];
      }
    }
    return [];
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-zinc-50 dark:bg-zinc-950 overflow-hidden text-zinc-900 dark:text-zinc-100">
      {/* Left Main Content */}
      <div
        className={`flex-1 flex flex-col h-full overflow-hidden transition-all ${selectedImage ? "mr-96" : ""}`}
      >
        {/* Header */}
        <header className="flex-none p-6 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center shadow-sm z-10">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Photo Reviews</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {images.length} photos in {groups.length} rooms
            </p>
          </div>

          <div className="flex gap-4">
            <button
              onClick={fetchImages}
              className="p-2.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin text-zinc-400" : ""}`} />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              accept="image/*"
            />
            <button
              onClick={handleUploadClick}
              disabled={uploading}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-md font-medium transition-colors shadow-sm"
            >
              {uploading ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5" />
                  Upload Photo
                </>
              )}
            </button>
          </div>
        </header>

        {/* Gallery */}
        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          {loading && images.length === 0 ? (
            <div className="flex items-center justify-center h-full text-zinc-500">
              <RefreshCw className="w-8 h-8 animate-spin mr-3" />
              <span>Loading gallery...</span>
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500">
              <div className="w-24 h-24 mb-6 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <FileImage className="w-10 h-10 text-zinc-400" />
              </div>
              <h3 className="text-xl font-medium text-zinc-900 dark:text-zinc-100">
                No photos yet
              </h3>
              <p className="mt-2 text-center max-w-sm">
                Upload some photos to get started. Workers AI will automatically identify the room
                and generate tags.
              </p>
              <button
                onClick={handleUploadClick}
                className="mt-6 px-6 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-md font-medium shadow-sm hover:ring-2 hover:ring-offset-2 hover:ring-zinc-900 dark:hover:ring-white transition-all"
              >
                Upload First Photo
              </button>
            </div>
          ) : (
            <div className="space-y-12 pb-12">
              {groups.map((group) => (
                <div key={group.room}>
                  <div className="flex items-center gap-3 mb-6 sticky top-0 bg-zinc-50/90 dark:bg-zinc-950/90 backdrop-blur-sm py-2 z-10 border-b border-transparent">
                    <div className="p-2 bg-zinc-200 dark:bg-zinc-800 rounded-md">
                      <Home className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
                    </div>
                    <h2 className="text-xl font-semibold capitalize">{group.room}</h2>
                    <span className="bg-zinc-200 dark:bg-zinc-800 text-xs px-2.5 py-1 rounded-full font-medium">
                      {group.images.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {group.images.map((img) => {
                      const isSelected = selectedImage?.id === img.id;
                      const tags = getTags(img.tags);

                      return (
                        <div
                          key={img.id}
                          onClick={() => setSelectedImage(img)}
                          className={`group relative aspect-[4/3] rounded-xl overflow-hidden cursor-pointer transition-all duration-300 bg-zinc-200 dark:bg-zinc-800 ${
                            isSelected
                              ? "ring-4 ring-blue-500 ring-offset-2 dark:ring-offset-zinc-950 shadow-xl scale-[0.98]"
                              : "hover:shadow-md hover:ring-2 hover:ring-zinc-300 dark:hover:ring-zinc-700 hover:ring-offset-1 dark:hover:ring-offset-zinc-950"
                          }`}
                        >
                          <img
                            src={img.path.startsWith('http') ? img.path : `/images/${img.path}`}
                            alt={img.filename}
                            loading="lazy"
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />

                          {/* Tags Overlay */}
                          <div
                            className={`absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-300 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                          >
                            <div className="flex flex-wrap gap-1.5 mt-4">
                              {tags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="text-[10px] uppercase tracking-wider font-semibold bg-white/20 text-white backdrop-blur-md px-1.5 py-0.5 rounded"
                                >
                                  {tag}
                                </span>
                              ))}
                              {tags.length > 3 && (
                                <span className="text-[10px] uppercase tracking-wider font-semibold bg-white/10 text-white backdrop-blur-md px-1.5 py-0.5 rounded">
                                  +{tags.length - 3}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Selection Check */}
                          {isSelected && (
                            <div className="absolute top-3 right-3 bg-blue-500 text-white p-1 rounded-full shadow-lg z-10">
                              <Check className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Side Panel */}
      <div
        className={`fixed top-16 bottom-0 right-0 w-96 bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl transition-transform duration-300 transform ${selectedImage ? "translate-x-0" : "translate-x-full"} flex flex-col z-20`}
      >
        {/* Panel Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h2 className="font-semibold truncate pr-4 text-zinc-900 dark:text-zinc-100">
            {selectedImage?.filename || "Details"}
          </h2>
          <button
            onClick={() => setSelectedImage(null)}
            className="p-1.5 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {selectedImage && (
          <div className="flex-1 overflow-y-auto flex flex-col">
            {/* Image Preview */}
            <div className="w-full bg-zinc-100 dark:bg-zinc-950 flex items-center justify-center overflow-hidden border-b border-zinc-200 dark:border-zinc-800">
              <img
                src={selectedImage.path}
                alt="Selected"
                className="max-h-64 object-contain"
              />
            </div>

            {/* Editing Form */}
            <div className="p-5 flex-1 flex flex-col gap-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                  <Home className="w-3.5 h-3.5" /> Room
                </label>
                <input
                  type="text"
                  value={panelRoom}
                  onChange={(e) => setPanelRoom(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                  placeholder="e.g. Kitchen"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" /> Tags (comma separated)
                </label>
                <textarea
                  value={panelTags}
                  onChange={(e) => setPanelTags(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow resize-none"
                  placeholder="e.g. modern, oak cabinets, dark floor"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                  <FileImage className="w-3.5 h-3.5" /> Design Notes
                </label>
                <textarea
                  value={panelNote}
                  onChange={(e) => setPanelNote(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow resize-none"
                  placeholder="Add your thoughts about this photo..."
                />
              </div>

              <div className="mt-auto pt-4 pb-2">
                <button
                  onClick={saveSelectedImage}
                  disabled={isSaving}
                  className="w-full flex items-center justify-center gap-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2.5 rounded-md font-medium hover:bg-zinc-800 dark:hover:bg-white transition-colors disabled:opacity-70"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      <Check className="w-5 h-5" /> Save Changes
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
