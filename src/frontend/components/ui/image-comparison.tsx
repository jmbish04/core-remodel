import React from "react";

import { ImageCompareSlider } from "@/components/ImageCompareSlider";

export interface ImageComparisonProps {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
  defaultValue?: number;
  className?: string;
  aspectClassName?: string;
}

export function ImageComparison(props: ImageComparisonProps) {
  return <ImageCompareSlider {...props} />;
}
