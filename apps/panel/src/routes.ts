// Route config for React Router framework mode (appDirectory "src"). Plain
// route entries, so shipped source does not import the dev-only
// @react-router/dev helpers.
export default [
  { index: true, file: "routes/home.tsx" },
  { path: "sign-in", file: "routes/sign-in.tsx" },
  { path: "sign-in/verify", file: "routes/sign-in-verify.ts" },
  {
    id: "routes/panel-layout",
    file: "routes/panel-layout.tsx",
    children: [
      { path: "inventory", file: "routes/inventory.tsx" },
      { path: "standards", file: "routes/standards.tsx" },
    ],
  },
];
