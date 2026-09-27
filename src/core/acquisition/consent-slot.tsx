/** Keep the disabled feature out of the rendered client tree and its requests. */
export async function AttributionConsentSlot() {
  if (process.env.ACQUISITION_ATTRIBUTION !== "true") return null;
  const { AttributionConsent } = await import("./consent");
  return <AttributionConsent />;
}
