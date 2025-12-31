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
      {/* Categories Header - Sticky & Premium */}
      <div className="sticky top-0 z-10 glass border-b border-stone-200/50 backdrop-blur-md">
        <div className="flex gap-4 overflow-x-auto p-4 scrollbar-hide shrink-0 items-center">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`pb-1 text-sm tracking-widest uppercase transition-all whitespace-nowrap font-medium ${activeCategory === cat
                  ? 'text-[#1B4332] border-b-2 border-[#D4A574]'
                  : 'text-stone-400 hover:text-[#1B4332] border-b-2 border-transparent'
                }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-fr">
        {filteredMenu.map(item => (
          <div key={item.id} className="group bg-white rounded-sm border border-stone-100 hover:border-[#D4A574] transition-all duration-300 hover:shadow-xl hover:shadow-stone-200/50 flex flex-col h-full relative overflow-hidden">

            {/* Abstract Header Gradient (Simulating Image placeholder) */}
            <div className="h-2 bg-gradient-to-r from-stone-200 to-stone-100 group-hover:from-[#FDF8F3] group-hover:to-[#D4A574]/20 transition-colors"></div>

            <div className="p-5 flex flex-col flex-1">
              <div className="flex justify-between items-start mb-2 gap-4">
                <h3 className="font-serif font-semibold text-xl text-[#1B4332] leading-tight group-hover:text-[#BC6C4F] transition-colors">
                  {item.name}
                </h3>
                <span className="font-mono text-base font-medium text-stone-800 shrink-0">
                  {item.price.toFixed(2)}€
                </span>
              </div>

              <div className="w-8 h-px bg-[#D4A574] mb-3 opacity-50"></div>

              <p className="text-sm text-stone-500 font-light leading-relaxed mb-4 flex-1">
                {item.description}
              </p>

              <div className="space-y-3 mt-2">
                {/* Diet Tags */}
                {item.dietary.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {item.dietary.map((d, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold text-emerald-800 bg-emerald-50/50 px-2 py-1 rounded-sm border border-emerald-100">
                        {getDietIcon(d)} {d}
                      </span>
                    ))}
                  </div>
                )}

                {/* Allergens - Minimalist */}
                {item.allergens.length > 0 && (item.allergens[0] !== 'ninguno') && (
                  <div className="flex items-center gap-1.5 text-[10px] text-stone-400">
                    <AlertCircle size={10} />
                    <span className="italic">Alergenos: {item.allergens.join(', ')}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Add Button - Subtle until hover */}
            <div className="p-4 pt-0 mt-auto">
              <button
                onClick={() => onAddItem(item)}
                className="w-full py-3 bg-stone-50 text-stone-600 text-xs font-bold uppercase tracking-widest hover:bg-stone-900 hover:text-white transition-all duration-300 rounded-sm flex items-center justify-center gap-2 group-hover:bg-stone-100 group-hover:text-stone-900"
              >
                <Plus size={14} />
                Añadir al pedido
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MenuExplorer;