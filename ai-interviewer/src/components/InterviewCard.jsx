export default function InterviewCard({
  title,
  score,
}) {
  return (
    <div
      className="
      bg-slate-900
      border
      border-slate-800
      rounded-2xl
      p-5"
    >
      <h2 className="font-semibold text-lg">
        {title}
      </h2>

      <p className="text-purple-400 mt-2">
        Score: {score}%
      </p>
    </div>
  );
}