with open("src/frontend/components/UploadsMappingPanel.tsx", "r") as f:
    content = f.read()

# Update props interface
old_props = """interface UploadsMappingPanelProps {
  refreshToken?: number;
  onSummaryChange?: (summary: MappingSummary) => void;
}"""

new_props = """interface UploadsMappingPanelProps {
  refreshToken?: number;
  onSummaryChange?: (summary: MappingSummary) => void;
  category?: MappingCategory;
  onCategoryChange?: (category: MappingCategory) => void;
}"""

content = content.replace(old_props, new_props)

# Update component signature and state
old_sig = """export function UploadsMappingPanel(props: UploadsMappingPanelProps) {
  const { refreshToken = 0, onSummaryChange } = props;
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [activeCategory, setActiveCategory] = useState<MappingCategory>("inspirational");"""

new_sig = """export function UploadsMappingPanel(props: UploadsMappingPanelProps) {
  const { refreshToken = 0, onSummaryChange, category = "inspirational", onCategoryChange } = props;
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [activeCategory, setActiveCategory] = useState<MappingCategory>(category);

  // Sync with prop
  useEffect(() => {
    setActiveCategory(category);
  }, [category]);

  const handleCategoryChange = useCallback((newCategory: MappingCategory) => {
    setActiveCategory(newCategory);
    onCategoryChange?.(newCategory);
  }, [onCategoryChange]);"""

content = content.replace(old_sig, new_sig)

# Use handleCategoryChange
content = content.replace('onClick={() => setActiveCategory("inspirational")}', 'onClick={() => handleCategoryChange("inspirational")}')
content = content.replace('onClick={() => setActiveCategory("listing")}', 'onClick={() => handleCategoryChange("listing")}')

with open("src/frontend/components/UploadsMappingPanel.tsx", "w") as f:
    f.write(content)
