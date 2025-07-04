import React from 'react';

export const Input = React.forwardRef(function Input({ className = '', ...props }, ref) {
  return (
    <input
      ref={ref}
      className={`rounded-xl border border-slate-300 p-3 focus:border-indigo-500 focus:outline-none ${className}`}
      {...props}
    />
  );
});
