import { Column, Row, Section, Text } from "react-email";

import { emailBrand as brand } from "../brand";

/** 键值明细（套餐、金额、日期等），值为空的行不显示。 */
export function DetailRows({
  rows,
}: {
  rows: Array<[label: string, value: string | null | undefined]>;
}) {
  const visible = rows.filter(
    (row): row is [string, string] => typeof row[1] === "string",
  );
  if (visible.length === 0) return null;
  return (
    <Section
      style={{
        margin: "0 0 20px",
        padding: "12px 16px",
        backgroundColor: brand.background,
        borderRadius: "8px",
      }}
    >
      {visible.map(([label, value]) => (
        <Row key={label}>
          <Column style={{ width: "45%", verticalAlign: "top" }}>
            <Text style={cell(brand.muted)}>{label}</Text>
          </Column>
          <Column style={{ verticalAlign: "top" }}>
            <Text style={{ ...cell(brand.text), fontWeight: 600 }}>
              {value}
            </Text>
          </Column>
        </Row>
      ))}
    </Section>
  );
}

const cell = (color: string) => ({
  margin: "4px 0",
  fontSize: "14px",
  lineHeight: "20px",
  color,
});
