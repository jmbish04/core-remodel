/**
 * Config-area navigation. Every definition/config vocabulary gets one entry here
 * and one `/config/<group>/<name>` page. The config area opens in its own tab
 * with this grouped sidebar (see ConfigShell). Add a line here when you add a
 * new definition table + config page.
 */
export interface ConfigNavItem {
  href: string;
  label: string;
}
export interface ConfigNavGroup {
  id: string;
  label: string;
  items: ConfigNavItem[];
}

export const CONFIG_NAV: ConfigNavGroup[] = [
  {
    id: "property",
    label: "Property",
    items: [{ href: "/admin/config/address", label: "Property Address" }],
  },
  {
    id: "device",
    label: "This Device",
    items: [{ href: "/admin/config/device", label: "Device" }],
  },
  {
    id: "photo",
    label: "Photo & Products",
    items: [
      { href: "/admin/config/photo/categories", label: "Categories" },
      { href: "/admin/config/photo/subcategories", label: "Sub-categories" },
      { href: "/admin/config/photo/colors", label: "Colors" },
    ],
  },
];
