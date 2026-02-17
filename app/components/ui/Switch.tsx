import * as React from 'react';
import './switch.css'; // Import the dedicated stylesheet

export interface SwitchProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, ...props }, ref) => {
    const state = checked ? 'checked' : 'unchecked';

    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        data-state={state}
        className="switch-root"
        onClick={() => onCheckedChange(!checked)}
        ref={ref}
        {...props}
      >
        <span data-state={state} className="switch-thumb" />
      </button>
    );
  }
);
Switch.displayName = 'Switch';

export { Switch };