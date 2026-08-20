import type { Preview } from "@storybook/nextjs-vite";
import "../src/app/globals.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    a11y: {
      test: "error",
    },
    controls: {
      expanded: true,
    },
    viewport: {
      options: {
        phone390: {
          name: "手机 390 × 844",
          styles: { width: "390px", height: "844px" },
          type: "mobile",
        },
        tablet768: {
          name: "平板 768 × 1024",
          styles: { width: "768px", height: "1024px" },
          type: "tablet",
        },
        desktop1440: {
          name: "桌面 1440 × 900",
          styles: { width: "1440px", height: "900px" },
          type: "desktop",
        },
        shortLandscape: {
          name: "短横屏 844 × 390",
          styles: { width: "844px", height: "390px" },
          type: "mobile",
        },
      },
    },
  },
};

export default preview;
