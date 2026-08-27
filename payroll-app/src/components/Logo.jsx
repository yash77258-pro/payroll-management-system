import React from 'react';

const Logo = ({ width = 160, height = 160, ...props }) => (
  <svg width={width} height={height} viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg" {...props}>
    <defs>
      <linearGradient id="markGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1971c2" />
        <stop offset="100%" stopColor="#0b3d91" />
      </linearGradient>
    </defs>

    {/* Rounded square badge */}
    <rect x="8" y="8" width="144" height="144" rx="32" fill="url(#markGradient)" />

    {/* Document / paysheet icon */}
    <rect x="46" y="38" width="52" height="68" rx="6" fill="#ffffff" opacity="0.95" />
    <rect x="56" y="52" width="32" height="5" rx="2.5" fill="#0b3d91" />
    <rect x="56" y="64" width="32" height="5" rx="2.5" fill="#0b3d91" opacity="0.65" />
    <rect x="56" y="76" width="20" height="5" rx="2.5" fill="#0b3d91" opacity="0.65" />

    {/* Coin / payment badge overlapping the document */}
    <circle cx="104" cy="100" r="26" fill="#ffffff" />
    <circle cx="104" cy="100" r="26" fill="none" stroke="#2f9e44" strokeWidth="4" />
    <path d="M94 100 L101 108 L116 90" fill="none" stroke="#2f9e44" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default Logo;