// Route config for React Router framework mode (appDirectory "src"). Plain
// route entries, so shipped source does not import the dev-only
// @react-router/dev helpers.
export default [
  { index: true, file: "routes/home.tsx" },
  { path: "sign-in", file: "routes/sign-in.tsx" },
  { path: "sign-in/verify", file: "routes/sign-in-verify.ts" },
  // The alert band's dismissal is a resource action outside the layout: it
  // has no UI and it must never navigate the current page.
  { path: "accepted-deviation-alerts/dismissals", file: "routes/accepted-deviation-alert-dismiss.ts" },
  {
    id: "routes/panel-layout",
    file: "routes/panel-layout.tsx",
    children: [
      { path: "inventory", file: "routes/inventory.tsx" },
      { path: "applications/:applicationId", file: "routes/application.tsx" },
      { path: "standards", file: "routes/standards.tsx" },
      { path: "standards/:moduleId", file: "routes/module-standards.tsx" },
      { path: "projects", file: "routes/project-tree.tsx" },
      { path: "new-application", file: "routes/new-application.tsx" },
      { path: "accepted-deviation", file: "routes/accepted-deviation.tsx" },
      { path: "compilations", file: "routes/compilations.tsx" },
      { path: "guidance-access", file: "routes/guidance-access.tsx" },
    ],
  },
];
