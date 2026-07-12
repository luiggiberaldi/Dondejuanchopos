import React from 'react';

/**
 * Icono Isotipo: "Donde Juancho"
 * Representa el isotipo circular/cuadrado del negocio (3.png).
 */
export const LogoIcon = ({ className = "w-10 h-10" }) => {
  return (
    <img 
      src="/3.png" 
      alt="Icono Donde Juancho"
      className={`object-contain transition-transform duration-300 group-hover:scale-110 ${className}`}
    />
  );
};

/**
 * Logotipo Completo (Logo Horizontal)
 * Muestra el logo completo de Donde Juancho (4.png).
 */
export const LogoFull = ({ className = "" }) => {
  return (
    <div className={`flex items-center gap-2 group cursor-default ${className}`}>
      <div className="relative flex items-center justify-center">
         <img 
           src="/logo.png" 
           alt="Logo Donde Juancho"
           className="h-10 object-contain"
         />
         {/* Brillo sutil en hover */}
         <div className="absolute inset-0 bg-brand/5 rounded-full blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
      </div>
    </div>
  );
};
