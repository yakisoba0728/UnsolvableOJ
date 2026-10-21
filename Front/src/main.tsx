import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AuthProvider } from "./auth";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initMonitoring } from "./monitoring";
import "./styles.css";

initMonitoring();

let navigationVersion = 0;
const getNavigationVersion = () => navigationVersion;
const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <AuthProvider>
        <ErrorBoundary>
          <App getNavigationVersion={getNavigationVersion} />
        </ErrorBoundary>
      </AuthProvider>
    ),
  },
]);

// React·Suspense가 화면을 바꾸기 전에 이동을 감지한다. 같은 기록 항목으로 돌아올 때도 센다.
let location = router.state.location;
let pendingLocation = router.state.navigation.location;
router.subscribe((state) => {
  if (state.location !== location || state.navigation.location !== pendingLocation)
    navigationVersion += 1;
  location = state.location;
  pendingLocation = state.navigation.location;
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
