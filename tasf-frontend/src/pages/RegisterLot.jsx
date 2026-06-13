import { useState } from "react";
import { airports } from "../data/mockData";

export default function RegisterLot() {
  const [form, setForm] = useState({
    origin:"", destination:"", client:"", quantity:150, date:""
  });

  const handle = e =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h2 className="text-teal font-bold text-lg mb-1">
        REGISTRO DE LOTES
      </h2>
      <p className="text-green-400 text-xs mb-4">● ESTADO: REGISTRADA</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Formulario */}
        <div className="bg-[#031525] border border-teal/20 rounded p-4">
          <p className="text-teal text-xs font-bold uppercase mb-3">
            Ingesta de Datos
          </p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {[
              ["origin",      "Aeropuerto Origen",  "select"],
              ["destination", "Aeropuerto Destino",  "select"],
            ].map(([name, label, type]) => (
              <div key={name}>
                <label className="text-gray-500 text-[10px] uppercase block mb-1">
                  {label}
                </label>
                <select name={name} value={form[name]} onChange={handle}
                  className="w-full bg-[#021020] border border-white/10
                             rounded px-2 py-1.5 text-xs text-gray-300
                             focus:outline-none focus:border-teal">
                  <option value="">Seleccionar</option>
                  {airports.map(a => (
                    <option key={a.code} value={a.code}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="mb-3">
            <label className="text-gray-500 text-[10px] uppercase block mb-1">
              Nombre / Identificador de Cliente
            </label>
            <input name="client" value={form.client} onChange={handle}
              placeholder="Logística Global S.A."
              className="w-full bg-[#021020] border border-white/10 rounded
                         px-2 py-1.5 text-xs text-gray-300
                         focus:outline-none focus:border-teal"/>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-gray-500 text-[10px] uppercase block mb-1">
                Cantidad de Maletas
              </label>
              <input name="quantity" type="number" value={form.quantity}
                onChange={handle}
                className="w-full bg-[#021020] border border-white/10 rounded
                           px-2 py-1.5 text-xs text-gray-300
                           focus:outline-none focus:border-teal"/>
            </div>
            <div>
              <label className="text-gray-500 text-[10px] uppercase block mb-1">
                Fecha de Entrega
              </label>
              <input name="date" type="datetime-local" value={form.date}
                onChange={handle}
                className="w-full bg-[#021020] border border-white/10 rounded
                           px-2 py-1.5 text-xs text-gray-300
                           focus:outline-none focus:border-teal"/>
            </div>
          </div>
          <button className="w-full bg-teal hover:bg-teal/80 text-white
                             text-sm py-2 rounded font-medium tracking-wide
                             transition">
            INICIAR PLAN DE VIAJE »
          </button>
          <div className="grid grid-cols-2 gap-2 mt-3 text-[10px]">
            <div>
              <p className="text-gray-500">Capacidad Almacén Origen</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-yellow-400 font-bold">24%</span>
                <div className="flex-1 bg-white/10 rounded-full h-1">
                  <div className="bg-yellow-400 h-1 rounded-full w-1/4"/>
                </div>
              </div>
            </div>
            <div>
              <p className="text-gray-500">Capacidad Almacén Destino</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-yellow-400 font-bold">58%</span>
                <div className="flex-1 bg-white/10 rounded-full h-1">
                  <div className="bg-yellow-400 h-1 rounded-full w-3/5"/>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Panel de validación */}
        <div className="bg-[#031525] border border-teal/20 rounded p-4">
          <p className="text-teal text-xs font-bold uppercase mb-3">
            Panel de Validación
          </p>
          {[
            { icon:"✓", color:"text-green-400",
              title:"Capacidad de Almacén: Origen",
              desc:"Existe suficiente espacio en el Terminal A-4. Disponibilidad actual: 4,200 maletas." },
            { icon:"~", color:"text-yellow-400",
              title:"Capacidad Estimada en Almacén Destino",
              desc:"Espacio proyectado en Terminal B-12 para T+36h es 62%. Dentro del rango seguro." },
            { icon:"✓", color:"text-green-400",
              title:"Viabilidad de Ruta",
              desc:"Ruta confirmada, tiempo aproximado 2 días." },
          ].map((v, i) => (
            <div key={i}
              className="flex gap-2 mb-3 bg-[#021020] rounded p-2">
              <span className={`font-bold text-sm ${v.color}`}>{v.icon}</span>
              <div>
                <p className="text-gray-300 text-xs font-medium">{v.title}</p>
                <p className="text-gray-500 text-[10px] mt-0.5">{v.desc}</p>
              </div>
            </div>
          ))}

          <p className="text-teal text-[10px] font-bold uppercase mt-3 mb-2">
            Ruta Planeada
          </p>
          {[
            { n:"01", code:"JF KENNEDY (JFK)", role:"Centro de Origen — Registro" },
            { n:"02", code:"HEATHROW (LHR)",   role:"Punto de Transbordo Intermedio" },
            { n:"03", code:"CHANGI (SIN)",      role:"Llegada y Clasificación en Destino" },
          ].map(r => (
            <div key={r.n}
              className="flex items-center gap-2 mb-1 text-xs">
              <span className="w-5 h-5 rounded-full bg-teal flex items-center
                               justify-center text-[10px] font-bold flex-shrink-0">
                {r.n}
              </span>
              <div>
                <p className="text-gray-200 font-medium">{r.code}</p>
                <p className="text-gray-500 text-[10px]">{r.role}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}