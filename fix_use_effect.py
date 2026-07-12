with open("src/frontend/components/UploadsMappingPanel.tsx", "r") as f:
    content = f.read()

old_code = """  const { refreshToken = 0, onSummaryChange, category = "inspirational", onCategoryChange } = props;
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

new_code = """  const { refreshToken = 0, onSummaryChange, category, onCategoryChange } = props;
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [localCategory, setLocalCategory] = useState<MappingCategory>("inspirational");
  const activeCategory = category ?? localCategory;

  const handleCategoryChange = useCallback((newCategory: MappingCategory) => {
    setLocalCategory(newCategory);
    onCategoryChange?.(newCategory);
  }, [onCategoryChange]);"""

content = content.replace(old_code, new_code)

with open("src/frontend/components/UploadsMappingPanel.tsx", "w") as f:
    f.write(content)
