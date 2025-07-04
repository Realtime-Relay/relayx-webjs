import React from 'react';

export function Button({ children, size = 'md', disabled, className = '', ...props }) {
  const base = 'inline-flex items-center justify-center rounded-2xl shadow font-medium transition';
  const sizes = {
    icon: 'h-10 w-10',
    lg: 'h-11 px-6 text-lg',
    md: 'h-10 px-4',
  };
  const cls = `${base} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 ${sizes[size]} ${className}`;
  return (
    <button className={cls} disabled={disabled} {...props}>
      {children}
    </button>
  );
}
