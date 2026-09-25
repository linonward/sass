import { Button } from "react-email";

import { emailBrand as brand } from "../brand";

/** 品牌色主按钮。 */
export function EmailButton({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      href={href}
      style={{
        display: "inline-block",
        margin: "8px 0 24px",
        padding: "12px 20px",
        borderRadius: "8px",
        backgroundColor: brand.primary,
        color: brand.onPrimary,
        fontSize: "15px",
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      {children}
    </Button>
  );
}
