import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider } from "./context/AuthContext";
import { AdminAuthProvider } from "./context/AdminAuthContext";
import { ToastProvider } from "./context/ToastContext";
import ProtectedRoute from "./routes/ProtectedRoute";
import AdminProtectedRoute from "./routes/AdminProtectedRoute";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import SignupPage from "./pages/SignupPage";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import MarketsPage from "./pages/MarketsPage";
import TradePage from "./pages/TradePage";
import MenuPage from "./pages/MenuPage";
import DepositPage from "./pages/DepositPage";
import WithdrawPage from "./pages/WithdrawPage";
import WalletPage from "./pages/WalletPage";
import BotsPage from "./pages/BotsPage";
import BotDetailPage from "./pages/BotDetailPage";
import CreateBotPage from "./pages/CreateBotPage";
import FakeSessionPage from "./pages/FakeSessionPage";
import KycPage from "./pages/KycPage";
import AdminLoginPage from "./pages/AdminLoginPage";
import AdminWinRatePage from "./pages/AdminWinRatePage";
import AdminKycQueuePage from "./pages/AdminKycQueuePage";
import AdminWithdrawalsQueuePage from "./pages/AdminWithdrawalsQueuePage";
import AdminConsolidationAddressesPage from "./pages/AdminConsolidationAddressesPage";
import AdminSweepsPage from "./pages/AdminSweepsPage";

function App() {
  return (
    <ToastProvider>
      <ThemeProvider>
        <AuthProvider>
          <AdminAuthProvider>
            <BrowserRouter>
            <Routes>
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/login" element={<LoginPage />} />

            {/* Tab-root screens — all 6 bottom-nav destinations now live
                here (see TabBar.jsx). AppShell renders the fixed tab bar
                around whichever of these is active via a nested
                <Outlet/>. Pushed screens reached FROM one of these (bot
                detail, deposit, withdraw, KYC, the create-bot wizard) stay
                outside this group, further down — they keep their own
                back-chevron top nav and no tab bar, since you navigate
                back out of them rather than switching tabs. */}
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<HomePage />} />
              <Route path="/markets" element={<MarketsPage />} />
              <Route path="/trade" element={<TradePage />} />
              <Route path="/bots" element={<BotsPage />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/menu" element={<MenuPage />} />
            </Route>

            <Route
              path="/deposit"
              element={
                <ProtectedRoute>
                  <DepositPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/withdraw"
              element={
                <ProtectedRoute>
                  <WithdrawPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/bots/create"
              element={
                <ProtectedRoute>
                  <CreateBotPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/bots/demo"
              element={
                <ProtectedRoute>
                  <FakeSessionPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/bots/:botId"
              element={
                <ProtectedRoute>
                  <BotDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/kyc"
              element={
                <ProtectedRoute>
                  <KycPage />
                </ProtectedRoute>
              }
            />

            {/* Admin — a separate credential from the regular user routes
                above (see AdminAuthContext.jsx); /admin/login is public,
                everything else under /admin requires an admin session. */}
            <Route path="/admin/login" element={<AdminLoginPage />} />
            <Route
              path="/admin/win-rate"
              element={
                <AdminProtectedRoute>
                  <AdminWinRatePage />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/kyc"
              element={
                <AdminProtectedRoute>
                  <AdminKycQueuePage />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/withdrawals"
              element={
                <AdminProtectedRoute>
                  <AdminWithdrawalsQueuePage />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/consolidation-addresses"
              element={
                <AdminProtectedRoute>
                  <AdminConsolidationAddressesPage />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/sweeps"
              element={
                <AdminProtectedRoute>
                  <AdminSweepsPage />
                </AdminProtectedRoute>
              }
            />
          </Routes>
            </BrowserRouter>
          </AdminAuthProvider>
        </AuthProvider>
      </ThemeProvider>
      {/* Rendered once here, outside the router, so it survives route
          changes and stays available to every screen — including the
          login/signup pages, which sit above ProtectedRoute and would
          otherwise have no toast layer at all. */}
      <Toast />
    </ToastProvider>
  );
}

export default App;
