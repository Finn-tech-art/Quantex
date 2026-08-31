import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import CountryGate from "../components/CountryGate";

export default function ProtectedRoute({ children }) {
  const { accessToken, user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <AnimatedPsi mode="working" size={36} color="var(--teal-base)" />
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  // `user` is still null for one tick after accessToken lands (the /auth/me
  // fetch in AuthContext hasn't resolved yet) — treat that the same as
  // `loading` above rather than flashing the country gate at everyone for a
  // frame. Once user IS loaded, a null country means either a Google OAuth
  // signup (that flow never passes through SignupRequest, so it never had a
  // chance to collect one) or a pre-existing account from before country was
  // collected at all — either way, gate every protected screen behind
  // picking one, same as this component already gates all of them on being
  // logged in at all.
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <AnimatedPsi mode="working" size={36} color="var(--teal-base)" />
      </div>
    );
  }

  if (!user.country) {
    return <CountryGate />;
  }

  return children;
}
