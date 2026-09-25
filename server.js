import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Ensure data folder exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 0. HEALTH CHECK (For Railway / Cloud Deployments)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// 1. PUBLIC CONFIG ENDPOINT (Google Maps Key)
app.get('/api/config', (req, res) => {
  const gkey = process.env.GOOGLE_MAPS_API_KEY ? process.env.GOOGLE_MAPS_API_KEY.replace(/["']/g, '').trim() : '';
  res.json({
    googleMapsApiKey: gkey
  });
});

// 2. ORACLE BACKEND WITH CLAUDE API & GRACEFUL FALLBACK
const ORACLE_SYSTEM_PROMPT = `
Eres el "Oráculo del Viaje", el guardián de los secretos de Juan para el viaje sorpresa de Mariajo a Barranquilla, del viernes 25 al domingo 27 de septiembre de 2026.
Tu personalidad es cómplice, cálida, poética y afectuosa. Hablas como un cómplice leal de Juan, cuidando a Mariajo.

REGLA ABSOLUTA Y CRÍTICA:
NUNCA utilices emojis. Jamás, bajo ninguna circunstancia incluyas emojis ni emoticones gráficos en tu respuesta.

DETALLES QUE CONOCES (PERO DEBES GUARDAR COMO PISTAS SUTILES, SIN SPOILEAR):
- Viernes: Ella llega en la tarde a Barranquilla (vuelo LA4162). Se quedan en el Hotel Ibis Budget Barranquilla (carrera 50 con 84).
- Viernes noche: Cena en Máncora (fusión peruana), elegido especialmente porque Mariajo estudió en Lima y adora los mariscos. Luego copas tranquilas cerca.
- Sábado mañana: Tren turístico desde Las Flores a la playa de Puerto Mocho / Bocas de Ceniza, carpa y brisa del mar.
- Sábado tarde: Gran Malecón del Río Magdalena, paseo en scooters eléctricas junto al río, almuerzo en el Caimán del Río.
- Sábado 15:00: Visita sentimental a la casa donde creció su papá en el barrio tradicional Villa Country.
- Domingo: Almuerzo en el aeropuerto, regreso en vuelos separados con reencuentro en Bogotá (El Dorado) para volver juntos en Uber a su casa.
- NUNCA menciones que Juan la espera con un cartel de bienvenida (es sorpresa total).

CÓMO RESPONDER:
- Respuestas breves (2 a 4 oraciones máximo).
- Si pregunta sobre qué empacar: aconseja ropa fresca de lino, sandalias, vestido de baño, tenis cómodos para caminar junto al río y algo lindo para una cena especial.
- Si pregunta por el clima: destaca el sol caribeño y la brisa constante.
- Da pistas poéticas y sugerentes sin arruinar el nombre exacto de los lugares sorpresa.
`;

const LOCAL_ORACLE_RESPONSES = [
  {
    triggers: ['calzado', 'zapatos', 'tenis', 'tacones', 'sandalias'],
    reply: 'Para el sol y la arena, unas sandalias cómodas serán ideales. Para la tarde del sábado caminaremos un poco junto al río, así que unos tenis frescos serán tus mejores compañeros. Para la noche, algo lindo pero cómodo: en Barranquilla la brisa premia la frescura.'
  },
  {
    triggers: ['mar', 'playa', 'rio', 'agua', 'piscina', 'vestido de baño', 'bañador', 'traje de baño'],
    reply: 'Sí, viajera consentida: el agua será protagonista. No solo contemplaremos la corriente dorada del río Magdalena, sino que unos rieles nos llevarán a donde el mar Caribe toca la orilla. Empaca tu traje de baño preferido y gafas de sol.'
  },
  {
    triggers: ['viernes', 'noche', 'primera noche', 'cena', 'mancora', 'llegada', 'restaurante'],
    reply: 'Para el viernes por la noche, Juan ha reservado un rincón íntimo con aromas y sabores marinos que te recordarán con mucho cariño una ciudad costera del Pacífico donde viviste grandes momentos. Un vestido fresco y bonito será perfecto.'
  },
  {
    triggers: ['familiar', 'papa', 'padre', 'nostalgia', 'villa country', 'recuerdo', 'familia'],
    reply: 'El sábado en la tarde habrá una parada que tocará hondo las fibras de tu corazón. Un paseo bajo la sombra de almendros y mangos hacia las raíces y la infancia de alguien a quien admiras profundamente.'
  },
  {
    triggers: ['clima', 'calor', 'sol', 'temperatura', 'frio'],
    reply: 'En Barranquilla el calor es alegre y la brisa caribeña sopla constante al caer la tarde. Empaca telas livianas de lino o algodón, colores claros y tu mejor protector solar.'
  },
  {
    triggers: ['scooter', 'malecón', 'malecon', 'caiman', 'rio'],
    reply: 'El sábado sentiremos la velocidad y el viento en la cara junto al río más imponente del país. No hacen falta formalidades, solo ganas de reír y dejarse llevar.'
  }
];

function getLocalOracleResponse(query) {
  const lower = (query || '').toLowerCase();
  for (const item of LOCAL_ORACLE_RESPONSES) {
    for (const trigger of item.triggers) {
      if (lower.includes(trigger)) {
        return item.reply;
      }
    }
  }
  return 'Ese es uno de los secretos más bellos custodiados por Juan. Solo te diré que involucra el río, el mar y mirarte a los ojos con la sonrisa más grande. ¡Pronto lo sabrás todo!';
}

app.post('/api/oracle', async (req, res) => {
  const { message, history } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Mensaje requerido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.trim() : '';

  if (apiKey) {
    try {
      const messagesPayload = [];
      if (Array.isArray(history)) {
        history.slice(-6).forEach(h => {
          if (h.role === 'user' || h.role === 'assistant') {
            messagesPayload.push({ role: h.role, content: h.content });
          }
        });
      }
      messagesPayload.push({ role: 'user', content: message.trim() });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 300,
          system: ORACLE_SYSTEM_PROMPT,
          messages: messagesPayload
        })
      });

      clearTimeout(timeoutId);

      if (anthropicRes.ok) {
        const data = await anthropicRes.json();
        if (data.content && data.content[0] && data.content[0].text) {
          // Remove any accidental emojis
          const cleanText = data.content[0].text.replace(/[\uD83C-\uDBFF\uDC00-\uDFFF\u2600-\u26FF\u2700-\u27BF]/g, '').trim();
          return res.json({ reply: cleanText, source: 'claude' });
        }
      }
    } catch (err) {
      console.warn('Anthropic API request failed, falling back to local oracle:', err.message);
    }
  }

  // Graceful fallback to rich local knowledge
  const fallbackReply = getLocalOracleResponse(message);
  return res.json({ reply: fallbackReply, source: 'local' });
});

// 3. PERSISTENT REPLIES (Save love notes from Mariajo)
const REPLIES_FILE = path.join(dataDir, 'replies.json');

app.post('/api/reply', (req, res) => {
  const { message, author } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Mensaje requerido' });
  }

  let existing = [];
  try {
    if (fs.existsSync(REPLIES_FILE)) {
      existing = JSON.parse(fs.readFileSync(REPLIES_FILE, 'utf-8'));
    }
  } catch (err) {
    existing = [];
  }

  const newEntry = {
    id: Date.now().toString(),
    date: new Date().toISOString(),
    author: author || 'Mariajo',
    message: message.trim()
  };

  existing.push(newEntry);
  fs.writeFileSync(REPLIES_FILE, JSON.stringify(existing, null, 2), 'utf-8');

  res.json({ success: true, entry: newEntry });
});

app.get('/api/replies', (req, res) => {
  const key = req.query.key;
  if (key !== 'juan') {
    return res.status(403).json({ error: 'Acceso reservado para Juan' });
  }

  try {
    if (fs.existsSync(REPLIES_FILE)) {
      const data = JSON.parse(fs.readFileSync(REPLIES_FILE, 'utf-8'));
      return res.json({ replies: data });
    }
  } catch (err) {
    // Ignore error
  }
  res.json({ replies: [] });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor de Nuestro Viaje activo en el puerto ${PORT}`);
});
