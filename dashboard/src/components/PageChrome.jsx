import { motion, useReducedMotion } from "framer-motion";

/**
 * @param {{ title: string, description?: string, kicker?: string, actions?: import('react').ReactNode, children: import('react').ReactNode }} props
 */
export function PageChrome({
  title,
  description,
  kicker = "Operator view · read-only",
  actions,
  children,
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="stack-lg"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }
      }
    >
      <header className="page-header">
        {kicker ? <p className="page-kicker">{kicker}</p> : null}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 className="page-title">{title}</h1>
            {description ? <p className="page-desc">{description}</p> : null}
          </div>
          {actions}
        </div>
      </header>
      {children}
    </motion.div>
  );
}
