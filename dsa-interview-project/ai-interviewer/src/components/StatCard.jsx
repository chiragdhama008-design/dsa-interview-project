export default function StatCard({
  title,
  value,
  trend,
}) {
  return (
    <div
      className="
      bg-slate-900
      border
      border-slate-800
      rounded-2xl
      p-6"
    >
      <p className="text-slate-400">
        {title}
      </p>

      <h2 className="text-4xl font-bold mt-3">
        {value}
      </h2>

      <p className="text-green-400 mt-2">
        {trend}
      </p>
    </div>
  );
}