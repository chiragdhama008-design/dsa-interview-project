import { BrowserRouter, Routes, Route } from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import Resume from "./pages/Resume";
import Interviews from "./pages/Interviews";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";
import InterviewRoom from "./pages/InterviewRoom";

function App() {
  return (
    <BrowserRouter>
      <Routes>

        <Route
          path="/"
          element={<Dashboard />}
        />

        <Route
          path="/resume"
          element={<Resume />}
        />

        <Route
          path="/interviews"
          element={<Interviews />}
        />

        <Route
          path="/analytics"
          element={<Analytics />}
        />

        <Route
          path="/settings"
          element={<Settings />}
        />
        <Route
  path="/room"
  element={<InterviewRoom />}
/>

      </Routes>
    </BrowserRouter>
  );
}

export default App;