const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
//  BASE DE DATOS EN MEMORIA
// ============================================================
const empresas = {
  'ADMIN': { cedula:'ADMIN', pin:'0000', nombre:'Administrador General', esAdmin:true, activo:true },
  '1234567': { cedula:'1234567', pin:'1112', nombre:'Transportes García', esAdmin:false, activo:true, vehiculos:['VH-G01','VH-G02'] },
  '7654321': { cedula:'7654321', pin:'2221', nombre:'Logística Pérez',    esAdmin:false, activo:true, vehiculos:['VH-P01','VH-P02'] },
  '9999999': { cedula:'9999999', pin:'3330', nombre:'Fletes Rodríguez',   esAdmin:false, activo:false, vehiculos:['VH-R01'] }
};

const vehicles = {
  'VH-G01': { id:'VH-G01', nombre:'Camión García 1', empresaCedula:'1234567', color:'#3B82F6', lat:-25.2867, lng:-57.6470, speed:0, heading:0, lastUpdate:new Date().toISOString(), history:[], insideRoute:true },
  'VH-G02': { id:'VH-G02', nombre:'Camión García 2', empresaCedula:'1234567', color:'#10B981', lat:-25.2950, lng:-57.6300, speed:0, heading:0, lastUpdate:new Date().toISOString(), history:[], insideRoute:true },
  'VH-P01': { id:'VH-P01', nombre:'Camión Pérez 1',  empresaCedula:'7654321', color:'#F59E0B', lat:-25.3010, lng:-57.6200, speed:0, heading:0, lastUpdate:new Date().toISOString(), history:[], insideRoute:true },
  'VH-P02': { id:'VH-P02', nombre:'Camión Pérez 2',  empresaCedula:'7654321', color:'#EF4444', lat:-25.3060, lng:-57.6250, speed:0, heading:0, lastUpdate:new Date().toISOString(), history:[], insideRoute:true },
  'VH-R01': { id:'VH-R01', nombre:'Camión Rodríguez',empresaCedula:'9999999', color:'#8B5CF6', lat:-25.3100, lng:-57.6100, speed:0, heading:0, lastUpdate:new Date().toISOString(), history:[], insideRoute:true }
};

const assignedRoutes = {
  'VH-G01': [{lat:-25.270,lng:-57.660},{lat:-25.270,lng:-57.630},{lat:-25.310,lng:-57.630},{lat:-25.310,lng:-57.660}],
  'VH-G02': [{lat:-25.280,lng:-57.640},{lat:-25.280,lng:-57.610},{lat:-25.320,lng:-57.610},{lat:-25.320,lng:-57.640}],
  'VH-P01': [{lat:-25.290,lng:-57.630},{lat:-25.290,lng:-57.600},{lat:-25.330,lng:-57.600},{lat:-25.330,lng:-57.630}],
  'VH-P02': [{lat:-25.295,lng:-57.635},{lat:-25.295,lng:-57.605},{lat:-25.335,lng:-57.605},{lat:-25.335,lng:-57.635}],
  'VH-R01': [{lat:-25.300,lng:-57.620},{lat:-25.300,lng:-57.590},{lat:-25.340,lng:-57.590},{lat:-25.340,lng:-57.620}]
};

// ── Historial por fecha: { vehicleId: { 'YYYY-MM-DD': [{lat,lng,time,speed}] } }
const historialPorFecha = {};

let vehCounter = 100;

// ============================================================
//  UTILIDADES
// ============================================================
function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i=0, j=n-1; i<n; j=i++) {
    const xi=polygon[i].lat, yi=polygon[i].lng;
    const xj=polygon[j].lat, yj=polygon[j].lng;
    if (((yi>lng)!==(yj>lng))&&(lat<(xj-xi)*(lng-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}

function calcHeading(prev, curr) {
  if (!prev) return 0;
  const angle = Math.atan2(curr.lng-prev.lng, curr.lat-prev.lat) * 180/Math.PI;
  return (angle+360)%360;
}

function fechaHoy() {
  return new Date().toISOString().slice(0,10);
}

function guardarHistorial(vehicleId, punto) {
  if (!historialPorFecha[vehicleId]) historialPorFecha[vehicleId] = {};
  const fecha = fechaHoy();
  if (!historialPorFecha[vehicleId][fecha]) historialPorFecha[vehicleId][fecha] = [];
  historialPorFecha[vehicleId][fecha].push(punto);
  // Guardar máximo 2000 puntos por día por vehículo
  if (historialPorFecha[vehicleId][fecha].length > 2000)
    historialPorFecha[vehicleId][fecha].shift();
}

// ============================================================
//  API — LOGIN
// ============================================================
app.post('/api/login', (req, res) => {
  const { cedula, pin } = req.body;
  const emp = empresas[cedula];
  if (!emp) return res.json({ ok:false, mensaje:'Cédula no registrada' });
  if (emp.pin !== pin) return res.json({ ok:false, mensaje:'PIN incorrecto' });
  if (!emp.activo) return res.json({ ok:false, mensaje:'Membresía suspendida. Contacte al administrador.' });
  res.json({
    ok:true, cedula:emp.cedula, nombre:emp.nombre, esAdmin:emp.esAdmin,
    vehiculos: emp.esAdmin ? Object.keys(vehicles) : (emp.vehiculos||[])
  });
});

// ============================================================
//  API — GPS
// ============================================================
app.post('/gps', (req, res) => {
  const { vehicleId, lat, lng, speed } = req.body;
  const v = vehicles[vehicleId];
  if (!v) return res.status(404).json({ error:'Vehículo no encontrado' });

  const prev = v.history.length ? v.history[v.history.length-1] : null;
  v.heading  = calcHeading(prev, { lat:parseFloat(lat), lng:parseFloat(lng) });
  v.lat      = parseFloat(lat);
  v.lng      = parseFloat(lng);
  v.speed    = parseFloat(speed)||0;
  v.lastUpdate = new Date().toISOString();

  const punto = { lat:v.lat, lng:v.lng, speed:v.speed, time:v.lastUpdate };
  v.history.push(punto);
  if (v.history.length > 200) v.history.shift();

  // Guardar en historial por fecha
  guardarHistorial(vehicleId, punto);

  const route = assignedRoutes[vehicleId];
  const wasInside = v.insideRoute;
  v.insideRoute = route ? pointInPolygon(v.lat, v.lng, route) : true;

  if (wasInside && !v.insideRoute)
    io.emit('alert', { vehicleId, vehicleName:v.nombre, empresaCedula:v.empresaCedula, type:'FUERA_DE_RUTA', message:`⚠️ ${v.nombre} salió de su ruta`, time:v.lastUpdate });
  if (!wasInside && v.insideRoute)
    io.emit('alert', { vehicleId, vehicleName:v.nombre, empresaCedula:v.empresaCedula, type:'REGRESO_RUTA', message:`✅ ${v.nombre} regresó a su ruta`, time:v.lastUpdate });

  io.emit('vehicleUpdate', v);
  res.json({ ok:true, insideRoute:v.insideRoute });
});

// ============================================================
//  API — DATOS
// ============================================================
app.get('/api/vehicles', (req, res) => res.json(Object.values(vehicles)));
app.get('/api/routes',   (req, res) => res.json(assignedRoutes));
app.get('/api/empresas', (req, res) => {
  res.json(Object.values(empresas).filter(e=>!e.esAdmin).map(e=>({
    cedula:e.cedula, nombre:e.nombre, activo:e.activo, pin:e.pin, vehiculos:e.vehiculos||[]
  })));
});

// Historial por fecha
// GET /api/historial/:vehicleId?fecha=YYYY-MM-DD
app.get('/api/historial/:vehicleId', (req, res) => {
  const { vehicleId } = req.params;
  const fecha = req.query.fecha || fechaHoy();
  const data = historialPorFecha[vehicleId]?.[fecha] || [];
  res.json({ vehicleId, fecha, puntos: data });
});

// Fechas disponibles para un vehículo
app.get('/api/historial/:vehicleId/fechas', (req, res) => {
  const { vehicleId } = req.params;
  const fechas = Object.keys(historialPorFecha[vehicleId]||{}).sort().reverse();
  res.json({ vehicleId, fechas });
});

// ============================================================
//  API ADMIN — EMPRESAS
// ============================================================
app.post('/api/admin/empresa', (req, res) => {
  const { cedula, pin, nombre } = req.body;
  if (!cedula||!pin||!nombre) return res.json({ ok:false, mensaje:'Faltan datos' });
  if (empresas[cedula]) return res.json({ ok:false, mensaje:'Esa cédula ya existe' });
  empresas[cedula] = { cedula, pin, nombre, esAdmin:false, activo:true, vehiculos:[] };
  res.json({ ok:true });
});

app.put('/api/admin/empresa/:cedula/estado', (req, res) => {
  const emp = empresas[req.params.cedula];
  if (!emp) return res.json({ ok:false });
  emp.activo = !emp.activo;
  res.json({ ok:true, activo:emp.activo });
});

// Cambiar PIN
app.put('/api/admin/empresa/:cedula/pin', (req, res) => {
  const emp = empresas[req.params.cedula];
  if (!emp) return res.json({ ok:false, mensaje:'Empresa no encontrada' });
  const { pin } = req.body;
  if (!pin || pin.length !== 4 || isNaN(pin)) return res.json({ ok:false, mensaje:'PIN debe ser 4 dígitos' });
  emp.pin = pin;
  res.json({ ok:true });
});

app.delete('/api/admin/empresa/:cedula', (req, res) => {
  const cedula = req.params.cedula;
  if (!empresas[cedula]) return res.json({ ok:false });
  (empresas[cedula].vehiculos||[]).forEach(vid => {
    delete vehicles[vid];
    delete assignedRoutes[vid];
    delete historialPorFecha[vid];
  });
  delete empresas[cedula];
  res.json({ ok:true });
});

// ============================================================
//  API ADMIN — VEHÍCULOS
// ============================================================
app.post('/api/admin/vehiculo', (req, res) => {
  const { nombre, empresaCedula, color } = req.body;
  if (!nombre||!empresaCedula) return res.json({ ok:false, mensaje:'Faltan datos' });
  if (!empresas[empresaCedula]) return res.json({ ok:false, mensaje:'Empresa no existe' });
  vehCounter++;
  const id = `VH-${empresaCedula.slice(-3)}-${vehCounter}`;
  const colores = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#84CC16'];
  vehicles[id] = {
    id, nombre, empresaCedula, color: color||colores[vehCounter%colores.length],
    lat:-25.2900, lng:-57.6400, speed:0, heading:0,
    lastUpdate:new Date().toISOString(), history:[], insideRoute:true
  };
  assignedRoutes[id] = [{lat:-25.270,lng:-57.660},{lat:-25.270,lng:-57.630},{lat:-25.310,lng:-57.630},{lat:-25.310,lng:-57.660}];
  empresas[empresaCedula].vehiculos.push(id);
  res.json({ ok:true, id });
});

app.delete('/api/admin/vehiculo/:id', (req, res) => {
  const id = req.params.id;
  const v = vehicles[id];
  if (!v) return res.json({ ok:false });
  const emp = empresas[v.empresaCedula];
  if (emp) emp.vehiculos = emp.vehiculos.filter(vid=>vid!==id);
  delete vehicles[id];
  delete assignedRoutes[id];
  delete historialPorFecha[id];
  res.json({ ok:true });
});

// ============================================================
//  SOCKET.IO
// ============================================================
io.on('connection', socket => {
  socket.emit('initialState', { vehicles:Object.values(vehicles), routes:assignedRoutes });
  socket.on('disconnect', ()=>{});
});

// ============================================================
//  SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(` FLEET PRO v3.0 — PWA + HISTORIAL`);
  console.log(` http://0.0.0.0:${PORT}`);
  console.log(` Admin: ADMIN / 0000`);
  console.log(`╚══════════════════════════════════════╝\n`);
});
