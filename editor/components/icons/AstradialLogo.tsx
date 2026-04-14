import React from "react";

interface AstradialLogoProps {
  className?: string;
  color?: string;
  height?: number;
  width?: number;
}

export const AstradialLogo: React.FC<AstradialLogoProps> = ({
  className = "",
  color = "currentColor",
  height,
  width,
}) => {
  const resolvedHeight = height ?? (width ? Math.round(width) : 24);
  const resolvedWidth = width ?? (height ? Math.round(height) : 24);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={resolvedWidth}
      height={resolvedHeight}
      viewBox="0 0 375 375"
      className={className}
      aria-label="Astradial Logo"
    >
      <g transform="matrix(1, 0, 0, 1, 18, 22)">
        <g fill={color} fillOpacity="1">
          <g transform="translate(0.853259, 266.92977)">
            <path d="M 172.078125 0 L 156.59375 -45.125 L 69.421875 -45.125 L 53.9375 0 L 3.734375 0 L 81.96875 -212 L 144.046875 -212 L 222.28125 0 Z M 82.234375 -82.375 L 143.640625 -82.375 L 113.609375 -169.671875 L 112.265625 -169.671875 Z M 82.234375 -82.375 " />
          </g>
        </g>
        <g fill={color} fillOpacity="1">
          <g transform="translate(235.072565, 266.92977)">
            <path d="M 27.5 0 L 27.5 -48.59375 L 75.6875 -48.59375 L 75.6875 0 Z M 27.5 0 " />
          </g>
        </g>
      </g>
    </svg>
  );
};

export default AstradialLogo;
