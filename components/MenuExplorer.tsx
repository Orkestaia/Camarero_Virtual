import React, { useMemo, useState } from 'react';
import { MenuItem } from '../types';
import { Leaf, Wheat, AlertCircle, Plus } from 'lucide-react';

interface MenuExplorerProps {
  menu: MenuItem[];
  onAddItem: (item: MenuItem) => void;
}

const MenuExplorer: React.FC<MenuExplorerProps> = ({ menu, onAddItem }) => {
  const [activeCategory, setActiveCategory] = useState<string>("Todos");

  const categories = useMemo(() => {
    const cats = Array.from(new Set(menu.map(m => m.category)));
    return ["Todos", ...cats];
  }, [menu]);

  const filteredMenu = useMemo(() => {
    if (activeCategory === "Todos") return menu;
    return menu.filter(m => m.category === activeCategory);
  }, [menu, activeCategory]);

  const getDietIcon = (diet: string) => {
    const d = diet.toLowerCase();
    if (d.includes('vegano') || d.includes('vegetariano')) return <Leaf size={10} className="text-emerald-700" />;
    if (d.includes('celiaco') || d.includes('gluten')) return <Wheat size={10} className="text-amber-700" />;
    return null;
  };

  return (
    <div className="h-full flex flex-col bg-[#FDF8F3]">
      {/* Categories Header - Sticky & Premium - Improved Touch Targets */}
      <div className="sticky top-0 z-10 glass border-b border-stone-200/50 backdrop-blur-md shadow-sm">
        <div className="flex gap-2 overflow-x-auto p-3 scrollbar-hide shrink-0 items-center px-4">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-full transition-all whitespace-nowrap active:scale-95 ${activeCategory === cat
                ? 'bg-[#1B4332] text-[#FDF8F3] shadow-md'
                : 'bg-white text-stone-500 border border-stone-200'
                }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-min pb-20">
        {filteredMenu.map(item => (
          <div key={item.id} className="group bg-white rounded-xl border border-stone-100 shadow-sm flex flex-col relative overflow-hidden active:border-[#D4A574] transition-colors">

            {/* Image Header */}
            {item.image ? (
              <div className="w-full h-48 overflow-hidden bg-stone-100">
                <img src={item.image} alt={item.name} loading="lazy" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="h-1 bg-[#1B4332]"></div>
            )}

            <div className="p-4 flex flex-col flex-1">
              <div className="flex justify-between items-start mb-2 gap-3">
                <div className="flex flex-col gap-1">
                  <h3 className="font-serif font-bold text-lg text-[#1B4332] leading-tight">
                    {item.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    {item.isTop3 && <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">⭐ Top</span>}
                    {item.isChefChoice && <span className="text-[10px] bg-[#BC6C4F]/10 text-[#BC6C4F] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">👨‍🍳 Chef</span>}
                  </div>
                </div>
                <span className="font-mono text-lg font-bold text-[#BC6C4F] shrink-0">
                  {item.price.toFixed(2)}€
                </span>
              </div>

              <p className="text-sm text-stone-500 font-normal leading-relaxed mb-4 line-clamp-3">
                {item.description}
              </p>

              <div className="mt-auto space-y-3">
                {/* Diet Tags (Compact) */}
                {item.dietary.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {item.dietary.map((d, i) => {
                      const lower = d.toLowerCase();
                      if (lower.includes('omnivoro') || lower.includes('omnívoro')) return null;

                      let icon = '🥗';
                      let colorClass = 'text-emerald-700 bg-emerald-50 border-emerald-100';

                      if (lower.includes('gluten')) { icon = '🌾🚫'; colorClass = 'text-amber-700 bg-amber-50 border-amber-100'; }
                      if (lower.includes('picante')) { icon = '🌶️'; colorClass = 'text-red-700 bg-red-50 border-red-100'; }

                      return (
                        <span key={i} className={`inline-flex items-center gap-1 text-[9px] uppercase font-bold px-2 py-1 rounded border ${colorClass}`}>
                          {icon} {d.replace('sin ', '')}
                        </span>
                      );
                    })}
                  </div>
                )}

                <button
                  onClick={() => onAddItem(item)}
                  className="w-full py-3.5 bg-stone-50 active:bg-[#1B4332] active:text-white text-stone-700 text-xs font-bold uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 transition-colors border border-stone-200"
                >
                  <Plus size={16} />
                  Añadir
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MenuExplorer;