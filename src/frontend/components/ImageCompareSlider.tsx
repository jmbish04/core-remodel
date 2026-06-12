import React from "react";
import { ImageComparison, type ImageComparisonProps } from "@/components/ui/image-comparison";

export type ImageCompareSliderProps = ImageComparisonProps;

export function ImageCompareSlider(props: ImageCompareSliderProps) {
  return <ImageComparison {...props} />;
}
