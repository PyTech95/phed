import { motion } from 'framer-motion';

export default function MaskedLine({ children, delay = 0, className = '' }) {
  return (
    <span className={`mask-line ${className}`}>
      <motion.span
        className="mask-line-inner"
        initial={{ y: '112%' }}
        animate={{ y: '0%' }}
        transition={{ duration: 1.1, delay, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.span>
    </span>
  );
}
