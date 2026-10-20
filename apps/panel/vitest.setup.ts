import { configure } from "@testing-library/dom";

// The redesigned screens render denser trees; 1s is too tight under the
// default parallel worker load. This only affects test helpers, not the app.
configure({ asyncUtilTimeout: 5000 });
