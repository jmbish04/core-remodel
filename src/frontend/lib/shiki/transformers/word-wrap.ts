import type { ShikiTransformer } from "shiki";

const wordWrapContent = (): ShikiTransformer => {
  return {
    name: "WordWrap",
    pre(node) {
      const existingClass = node.properties.class;
      if (Array.isArray(existingClass)) {
        existingClass.push("shiki-word-wrap");
      } else if (typeof existingClass === "string") {
        node.properties.class = `${existingClass} shiki-word-wrap`;
      } else {
        node.properties.class = "shiki-word-wrap";
      }
    },
  };
};

export { wordWrapContent };
