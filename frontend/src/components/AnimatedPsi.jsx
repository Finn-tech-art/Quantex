export default function AnimatedPsi({ mode = "static", size = 28, color = "currentColor" }) {
  const drawing = mode === "working";
  return (
    <svg
      viewBox="0 0 72 72"
      fill="none"
      stroke={color}
      width={size}
      height={size}
      className={`qx-psi-mark${drawing ? " qx-psi-drawing" : ""}`}
    >
      <path
        className="qx-psi-bowl"
        pathLength="1"
        d="M18 10 V32 Q18 44 36 44 Q54 44 54 32 V10"
        strokeWidth="7"
        strokeLinecap={drawing ? "round" : "square"}
      />
      <line
        className="qx-psi-stem"
        pathLength="1"
        x1="36"
        y1="10"
        x2="36"
        y2="62"
        strokeWidth="7"
        strokeLinecap={drawing ? "round" : "square"}
      />
    </svg>
  );
}
