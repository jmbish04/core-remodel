import { Upload, X, Check, Tag, FileImage, Home, RefreshCw, Crop, ZoomIn, ZoomOut } from "lucide-react";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import Cropper from "react-easy-crop";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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

interface StagedFile {
  id: string;
  file: File;
  preview: string;
  croppedBlob?: Blob;
  croppedPreview?: string;
}

interface CropState {
  crop: { x: number; y: number };
  zoom: number;
  croppedAreaPixels: any;
}

// Helper to create image from URL
const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.src = url;
  });

// Helper to crop image
const getCroppedImg = async (imageSrc: string, pixelCrop: any): Promise<Blob> => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("No 2d context");
  }

  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob!);
    }, "image/jpeg", 0.95);
  });
};

export function PhotoReviewApp() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [groups, setGroups] = useState<ImageGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  // Staged files for upload
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);

  // Cropping state
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [currentCropFile, setCurrentCropFile] = useState<StagedFile | null>(null);
  const [cropState, setCropState] = useState<CropState>({
    crop: { x: 0, y: 0 },
    zoom: 1,
    croppedAreaPixels: null,
  });

  // Zoom state for gallery
  const [zoomModalOpen, setZoomModalOpen] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<ImageRecord | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Panel form state
  const [panelRoom, setPanelRoom] = useState("");
  const [panelTags, setPanelTags] = useState("");
  const [panelNote, setPanelNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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
      toast.error("Failed to load images");
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

  // Dropzone configuration
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: StagedFile[] = acceptedFiles.map((file) => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      preview: URL.createObjectURL(file),
    }));
    setStagedFiles((prev) => [...prev, ...newFiles]);
    toast.success(`Added ${acceptedFiles.length} file(s) to upload queue`);
  }, []);

  const { getRootProps, getInputProps, isDragActive, open: openFileDialog } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
    },
    multiple: true,
    noClick: true,
  });

  // Remove staged file
  const removeStagedFile = (id: string) => {
    setStagedFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file) {
        URL.revokeObjectURL(file.preview);
        if (file.croppedPreview) URL.revokeObjectURL(file.croppedPreview);
      }
      return prev.filter((f) => f.id !== id);
    });
  };

  // Open crop modal
  const openCropModal = (stagedFile: StagedFile) => {
    setCurrentCropFile(stagedFile);
    setCropState({
      crop: { x: 0, y: 0 },
      zoom: 1,
      croppedAreaPixels: null,
    });
    setCropModalOpen(true);
  };

  // Handle crop complete
  const onCropComplete = useCallback((croppedArea: any, croppedAreaPixels: any) => {
    setCropState((prev) => ({ ...prev, croppedAreaPixels }));
  }, []);

  // Save cropped image
  const saveCroppedImage = async () => {
    if (!currentCropFile || !cropState.croppedAreaPixels) return;

    try {
      const croppedBlob = await getCroppedImg(currentCropFile.preview, cropState.croppedAreaPixels);
      const croppedPreview = URL.createObjectURL(croppedBlob);

      setStagedFiles((prev) =>
        prev.map((f) =>
          f.id === currentCropFile.id
            ? { ...f, croppedBlob, croppedPreview }
            : f
        )
      );

      toast.success("Image cropped successfully");
      setCropModalOpen(false);
      setCurrentCropFile(null);
    } catch (err) {
      console.error("Crop error:", err);
      toast.error("Failed to crop image");
    }
  };

  // Upload staged files with rate limiting
  const uploadStagedFiles = async () => {
    if (stagedFiles.length === 0) {
      toast.error("No files to upload");
      return;
    }

    setUploading(true);
    setUploadProgress({ current: 0, total: stagedFiles.length });

    let successCount = 0;
    let lastUploadedImage: ImageRecord | null = null;

    for (let i = 0; i < stagedFiles.length; i++) {
      const stagedFile = stagedFiles[i];
      const formData = new FormData();

      // Use cropped blob if available, otherwise original file
      if (stagedFile.croppedBlob) {
        formData.append("file", stagedFile.croppedBlob, stagedFile.file.name);
      } else {
        formData.append("file", stagedFile.file);
      }

      try {
        const res = await fetch("/api/photo-reviews/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || "Upload failed");
        }

        const data = (await res.json()) as { success?: boolean; image?: ImageRecord; error?: string };
        if (data.success) {
          successCount++;
          if (data.image) lastUploadedImage = data.image;
          toast.success(`Uploaded ${stagedFile.file.name}`);
        } else {
          toast.error(`Failed: ${stagedFile.file.name} - ${data.error}`);
        }
      } catch (err: any) {
        console.error(`Upload error for ${stagedFile.file.name}:`, err);
        toast.error(`Failed: ${stagedFile.file.name} - ${err.message}`);
      }

      setUploadProgress({ current: i + 1, total: stagedFiles.length });

      // Rate limiting: wait 500ms between uploads to respect Cloudflare API limits
      if (i < stagedFiles.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Clean up staged files
    stagedFiles.forEach((file) => {
      URL.revokeObjectURL(file.preview);
      if (file.croppedPreview) URL.revokeObjectURL(file.croppedPreview);
    });
    setStagedFiles([]);

    await fetchImages();
    if (lastUploadedImage) setSelectedImage(lastUploadedImage);

    setUploading(false);
    setUploadProgress(null);

    if (successCount === stagedFiles.length) {
      toast.success(`Successfully uploaded all ${successCount} files!`);
    } else {
      toast.warning(`Uploaded ${successCount} of ${stagedFiles.length} files`);
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
        toast.success("Changes saved successfully");
      }
    } catch (err) {
      console.error("Save error:", err);
      toast.error("Failed to save changes");
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

  // Open zoom modal
  const openZoomModal = (image: ImageRecord) => {
    setZoomedImage(image);
    setZoomLevel(1);
    setZoomModalOpen(true);
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
              {stagedFiles.length > 0 && ` • ${stagedFiles.length} staged`}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={fetchImages}
              className="p-2.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin text-zinc-400" : ""}`} />
            </button>
            <Button
              onClick={openFileDialog}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              disabled={uploading}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Photos
            </Button>
          </div>
        </header>

        {/* Main Content Area — the whole area is a drop zone (drag anywhere to add photos) */}
        <div {...getRootProps()} className="flex-1 overflow-y-auto p-6 scroll-smooth outline-none">
          {/* Hidden file input for dropzone */}
          <input {...getInputProps()} />

          {/* Drag-over overlay when dragging onto the window */}
          {isDragActive && (
            <div className="fixed inset-0 z-50 bg-blue-500/20 border-4 border-blue-500 border-dashed flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <Upload className="w-16 h-16 mx-auto mb-4 text-blue-500" />
                <p className="text-xl font-medium text-blue-700 dark:text-blue-300">Drop photos here</p>
              </div>
            </div>
          )}

          {/* Dropzone Area — shown only when no staged files and no images yet */}
          {stagedFiles.length === 0 && images.length === 0 && !loading && (
            <div
              className="border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600"
              onClick={openFileDialog}
            >
              <Upload className="w-16 h-16 mx-auto mb-4 text-zinc-400" />
              <h3 className="text-xl font-medium mb-2">
                Upload Photos
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Drag and drop images here, or click to browse
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2">
                Supports: PNG, JPG, JPEG, GIF, WEBP
              </p>
            </div>
          )}

          {/* Staged Files Preview */}
          {stagedFiles.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Staged Files ({stagedFiles.length})</h2>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={openFileDialog}>
                    <Upload className="w-4 h-4 mr-2" />
                    Add More
                  </Button>
                  <Button
                    onClick={uploadStagedFiles}
                    disabled={uploading}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {uploading ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Uploading {uploadProgress?.current}/{uploadProgress?.total}...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Confirm & Upload
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {stagedFiles.map((stagedFile) => (
                  <div
                    key={stagedFile.id}
                    className="relative group aspect-square rounded-lg overflow-hidden border-2 border-zinc-200 dark:border-zinc-800"
                  >
                    <img
                      src={stagedFile.croppedPreview || stagedFile.preview}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        onClick={() => openCropModal(stagedFile)}
                        className="p-2 bg-white dark:bg-zinc-800 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700"
                        title="Crop"
                      >
                        <Crop className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeStagedFile(stagedFile.id)}
                        className="p-2 bg-red-500 text-white rounded-md hover:bg-red-600"
                        title="Remove"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {stagedFile.croppedBlob && (
                      <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-2 py-1 rounded">
                        Cropped
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Existing Images Gallery */}
          {loading && images.length === 0 ? (
            <div className="flex items-center justify-center h-full text-zinc-500">
              <RefreshCw className="w-8 h-8 animate-spin mr-3" />
              <span>Loading gallery...</span>
            </div>
          ) : groups.length === 0 && stagedFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500">
              <div className="w-24 h-24 mb-6 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <FileImage className="w-10 h-10 text-zinc-400" />
              </div>
              <h3 className="text-xl font-medium text-zinc-900 dark:text-zinc-100">
                No photos yet
              </h3>
              <p className="mt-2 text-center max-w-sm mb-6">
                Upload photos to get started. Workers AI will automatically identify the room
                and generate tags. You can upload multiple photos at once or drag and drop them.
              </p>
              <div>
                <Button className="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900" onClick={openFileDialog}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Photos
                </Button>
              </div>
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
                            onClick={() => setSelectedImage(img)}
                          />

                          {/* Zoom button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openZoomModal(img);
                            }}
                            className="absolute top-2 right-2 p-2 bg-white/90 dark:bg-zinc-800/90 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white dark:hover:bg-zinc-800"
                            title="Zoom"
                          >
                            <ZoomIn className="w-4 h-4" />
                          </button>

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
                            <div className="absolute top-3 left-3 bg-blue-500 text-white p-1 rounded-full shadow-lg z-10">
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
                <Button
                  onClick={saveSelectedImage}
                  disabled={isSaving}
                  className="w-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      <Check className="w-5 h-5 mr-2" /> Save Changes
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Crop Modal */}
      <Dialog open={cropModalOpen} onOpenChange={setCropModalOpen}>
        <DialogContent className="max-w-3xl h-[600px]">
          <DialogHeader>
            <DialogTitle>Crop Image</DialogTitle>
          </DialogHeader>
          <div className="relative h-[400px] bg-zinc-100 dark:bg-zinc-950">
            {currentCropFile && (
              <Cropper
                image={currentCropFile.preview}
                crop={cropState.crop}
                zoom={cropState.zoom}
                aspect={4 / 3}
                onCropChange={(crop) => setCropState((prev) => ({ ...prev, crop }))}
                onZoomChange={(zoom) => setCropState((prev) => ({ ...prev, zoom }))}
                onCropComplete={onCropComplete}
              />
            )}
          </div>
          <div className="flex items-center gap-4 mt-4">
            <label className="text-sm font-medium">Zoom:</label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={cropState.zoom}
              onChange={(e) => setCropState((prev) => ({ ...prev, zoom: Number(e.target.value) }))}
              className="flex-1"
            />
            <span className="text-sm">{cropState.zoom.toFixed(1)}x</span>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setCropModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveCroppedImage} className="bg-blue-600 hover:bg-blue-700">
              <Check className="w-4 h-4 mr-2" />
              Apply Crop
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Zoom Modal */}
      <Dialog open={zoomModalOpen} onOpenChange={setZoomModalOpen}>
        <DialogContent className="max-w-6xl h-[90vh]">
          <DialogHeader>
            <DialogTitle>{zoomedImage?.filename}</DialogTitle>
          </DialogHeader>
          <div className="relative flex-1 overflow-auto bg-zinc-100 dark:bg-zinc-950">
            {zoomedImage && (
              <div className="flex items-center justify-center min-h-full p-4">
                <img
                  src={zoomedImage.path.startsWith('http') ? zoomedImage.path : `/images/${zoomedImage.path}`}
                  alt={zoomedImage.filename}
                  style={{ transform: `scale(${zoomLevel})` }}
                  className="max-w-full transition-transform duration-200"
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.5))}
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <input
              type="range"
              min={0.5}
              max={5}
              step={0.5}
              value={zoomLevel}
              onChange={(e) => setZoomLevel(Number(e.target.value))}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setZoomLevel((z) => Math.min(5, z + 0.5))}
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium min-w-[60px]">{zoomLevel.toFixed(1)}x</span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
