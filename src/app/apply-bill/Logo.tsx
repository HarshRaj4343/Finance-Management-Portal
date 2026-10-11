// Logo.tsx
import Image from "next/image";
import React from "react";
import { motion } from "motion/react";

export const Logo = () => (
  <a
    href="#"
    className="flex items-center space-x-2 py-1 text-base font-semibold text-black"
  >
    <Image width={80} height={80} src="/iit.png" alt="IIT Mandi" className="h-8 w-8" />
    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      IIT Mandi Bills
    </motion.span>
  </a>
);

export const LogoIcon = () => (
  <a
    href="#"
    className="flex items-center py-1 text-sm font-semibold text-black"
  >
    <Image width={80} height={80} src="/iit.png" alt="IIT Mandi" className="h-8 w-8" />
  </a>
);
