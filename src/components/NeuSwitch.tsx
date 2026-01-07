import React from 'react';
import styles from './NeuSwitch.module.css';

interface NeuSwitchProps {
    checked?: boolean;
    onChange?: (checked: boolean) => void;
    className?: string;
    hue?: number;
}

const NeuSwitch: React.FC<NeuSwitchProps> = ({ checked, onChange, className = '', hue = 220 }) => {
    return (
        <div className={`${styles.container} ${className}`} style={{ '--hue': `${hue}deg` } as React.CSSProperties}>
            <label className={styles.switch}>
                <input
                    type="checkbox"
                    className={styles.togglesw}
                    checked={checked}
                    onChange={(e) => onChange && onChange(e.target.checked)}
                />
                <div className={`${styles.indicator} ${styles.left}`}></div>
                <div className={`${styles.indicator} ${styles.right}`}></div>
                <div className={styles.button}></div>
            </label>
        </div>
    );
};

export default NeuSwitch;
