import { motion } from "framer-motion";

export const Greeting = () => (
  <div className="flex flex-col items-center px-4" key="overview">
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="text-center font-bold text-[28px] text-foreground"
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      哪里没懂？
    </motion.div>
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mt-2 text-center text-[15px] text-muted-foreground"
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.5, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      说说卡在哪儿，我们从你已经懂的地方接上。
    </motion.div>
  </div>
);
