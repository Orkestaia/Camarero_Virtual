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
          width: '40px',
          height: '40px',
          transform: `scale(${scale})`,
          opacity: 1
        }}
      >
        {isActive && (
          <div className="w-full h-full rounded-full animate-ping bg-white opacity-20 absolute" />
        )}
      </div>
    </div>
  );
};

export default Visualizer;