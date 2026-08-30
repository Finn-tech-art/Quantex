import { Navigate } from "react-router-dom";
import { useAdminAuth } from "../context/AdminAuthContext";
import AnimatedPsi from "../components/AnimatedPsi";

export default function AdminProtectedRoute({ children }) {
  const { adminToken, loading } = useAdminAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <AnimatedPsi mode="working" size={36} color="var(--teal-base)" />
      </div>
    );
  }

  if (!adminToken) {
    return <Navigate to="/admin/login" replace />;
  }

  return children;
}
