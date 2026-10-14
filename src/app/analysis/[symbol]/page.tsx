import { AnalysisView } from "./AnalysisView";

// Ruta completamente dinámica (depende del símbolo y de datos de mercado):
// se permite bloquear en lugar de generar un cascarón estático.
export const instant = false;

export default async function AnalysisPage({
  params,
}: PageProps<"/analysis/[symbol]">) {
  const { symbol } = await params;
  return <AnalysisView symbol={symbol} />;
}
