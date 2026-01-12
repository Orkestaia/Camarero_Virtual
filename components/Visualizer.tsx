import React from 'react';

interface VisualizerProps {
  isActive: boolean;
  volume: number; // 0 to 1
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, volume }) => {
  // Smooth out volume for visual effect
  const intensity = isActive ? Math.max(0.2, volume * 4) : 0.1;
  const scale = 1 + intensity * 0.5;
  const opacity = 0.5 + intensity * 0.5;

  return (
    <div className="flex items-center justify-center h-24 w-full relative">
      {/* Outer glow ring */}
      <div
        className={`absolute rounded-full transition-all duration-100 ease-out border border-[#D4A574]/30 ${isActive ? 'bg-[#D4A574]/10' : 'bg-stone-500/5'}`}
        style={{
          width: '80px',
          height: '80px',
          transform: `scale(${isActive ? scale * 1.5 : 1})`,
          opacity: isActive ? 0.3 : 0
        }}
      />

      {/* Middle ring */}
      <div
        className={`absolute rounded-full transition-all duration-150 ease-out ${isActive ? 'bg-[#D4A574]/20' : 'bg-stone-400/10'}`}
        style={{
          width: '60px',
          height: '60px',
          transform: `scale(${isActive ? scale * 1.2 : 1})`
        }}
      />

      {/* Core orb */}
      <div
        className={`relative rounded-full shadow-lg transition-all duration-75 flex items-center justify-center ${isActive
          ? 'bg-gradient-to-br from-[#D4A574] to-[#BC6C4F] shadow-[#D4A574]/50'
          : 'bg-stone-300 shadow-stone-200'
          }`}
        style={{
          width: '50px',
          height: '50px',
          transform: `scale(${scale})`,
          opacity: 1
        }}
      >
        {isActive && (
          <div className="w-full h-full rounded-full animate-ping bg-white opacity-20 absolute" />
        )}
        {/* ICON RESTORED */}
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-white transition-opacity duration-200 ${isActive ? 'opacity-100' : 'opacity-50'}`}>
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      </div>
    </div>
  );
};

export default Visualizer;