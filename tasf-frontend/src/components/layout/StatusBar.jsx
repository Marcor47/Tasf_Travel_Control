export default function StatusBar({ saturation, replanifications }) {
  return (
    <div className="flex items-center gap-6 px-4 py-1
                    bg-[#010f1e] border-t border-teal/20 text-xs text-gray-500">
      <span className="text-teal font-bold">TASFTRAVELCONTROL</span>
      <span>SATURACION DE LA RED: {saturation}%</span>
      <span>REPLANIFICACIONES: {replanifications}</span>
    </div>
  );
}
