// Slice 12: the privacy notice text. Plain strings rendered by React (never as HTML).
// English is the canonical source; es and da follow it.
import type { Lang } from "./messages";

/** Date shown as "Last updated". Change this single value when the text changes (and at merge time). */
export const PRIVACY_LAST_UPDATED = "2026-11-14";

export type PrivacySection = { heading: string; lines: string[] };
export type PrivacyNotice = { title: string; updatedLabel: string; sections: PrivacySection[] };

const en: PrivacyNotice = {
  title: "Privacy notice",
  updatedLabel: "Last updated",
  sections: [
    {
      heading: "Who is responsible",
      lines: ["The Atlas project is responsible for your data.", "Atlas is in a closed test and not yet open to the public. A contact address for privacy requests will be published here before it opens."],
    },
    {
      heading: "If you visit event maps",
      lines: [
        "You don't need an account. We don't add advertising or analytics tools, or tracking cookies, and we don't build profiles of visitors.",
        "Your browser only remembers your language and schedule zoom if you change them. That stays on your device.",
        "Your IP address is used for about one minute to protect the service from abuse (rate limiting), and to show events near you first (approximate location from your IP). Atlas itself doesn't store it.",
        'If you tap "Add to Google Calendar", Google receives that event\'s details.',
      ],
    },
    {
      heading: "If you are an organizer or were invited",
      lines: [
        "When you are invited, we store your email to check the invitation. We delete the invitation 30 days after it is used, revoked or expired.",
        "After you accept, your email stays in your organizer account, because we use it to recognize you when you sign in with Google.",
        "When you sign in with Google, we receive and keep your Google account ID, your email and your name. We don't get your password or anything else from your Google account.",
        "A session cookie keeps you signed in for up to 7 days. Expired sessions are removed.",
        "Your events are kept until you delete them. Once an event is published, its information is public. You are responsible for what you publish: please don't include other people's personal data without their permission.",
      ],
    },
    {
      heading: "Why we can do this",
      lines: ["To provide the service you asked for, and our legitimate interest in keeping it secure and free of abuse."],
    },
    {
      heading: "Who helps us",
      lines: [
        "Cloudflare hosts Atlas. Our database is stored in the EU. Some technical logs may be processed outside the EU, protected by the EU–US Data Privacy Framework and standard contractual clauses.",
        "As our hosting provider, Cloudflare records basic data about each request (IP address, approximate country, page requested and time) in its traffic analytics. We can view it for up to about 30 days, only to diagnose problems and stop abuse. We also see overall traffic statistics, such as visits by country, which don't identify anyone.",
        "Google provides sign-in and is responsible for your Google account under its own privacy policy.",
      ],
    },
    {
      heading: "How long we keep data",
      lines: [
        "Sessions: 7 days, then removed.",
        "Invitations: deleted 30 days after they are used, revoked or expired.",
        "Technical logs: 3 days, with an internal ID only (no email or name).",
        "Hosting traffic records (IP address, country, page, time): up to about 30 days, kept by Cloudflare.",
        "Database backups: up to 7 days. Data you delete can remain in backups until then.",
        "Your account: until you ask us to delete it.",
      ],
    },
    {
      heading: "Your rights",
      lines: [
        "You can ask to see, correct, export or delete your data, or object to how we use it. You can also complain to the Spanish Data Protection Agency (AEPD, www.aepd.es).",
      ],
    },
    {
      heading: "Cookies and storage",
      lines: [
        "__Host-atlas_oauth: used only while you sign in (10 minutes).",
        "__Host-atlas_session: keeps you signed in (7 days).",
        "atlas.lang and atlas.schedule.zoom: your language and zoom choices, stored in your browser.",
        "All of them are strictly necessary or saved only when you choose, so we don't ask for consent.",
      ],
    },
    { heading: "Changes", lines: ["If this notice changes, we update the date above."] },
  ],
};

const es: PrivacyNotice = {
  title: "Aviso de privacidad",
  updatedLabel: "Última actualización",
  sections: [
    {
      heading: "Quién es responsable",
      lines: ["El proyecto Atlas es responsable de tus datos.", "Atlas está en una prueba cerrada y todavía no está abierto al público. Antes de abrirlo, vamos a publicar acá una dirección de contacto para consultas de privacidad."],
    },
    {
      heading: "Si visitás mapas de eventos",
      lines: [
        "No necesitás cuenta. No agregamos herramientas de publicidad ni de analítica, ni cookies de seguimiento, y no armamos perfiles de quienes nos visitan.",
        "Tu navegador solo recuerda tu idioma y el zoom del programa si los cambiás. Eso queda en tu dispositivo.",
        "Tu dirección IP se usa durante aproximadamente un minuto para proteger el servicio de abusos (límite de peticiones) y para mostrarte primero los eventos cercanos (ubicación aproximada a partir de la IP). Atlas en sí no la almacena.",
        'Si tocás "Agregar a Google Calendar", Google recibe los datos de ese evento.',
      ],
    },
    {
      heading: "Si sos organizador o te invitaron",
      lines: [
        "Cuando te invitan, guardamos tu email para comprobar la invitación. Borramos la invitación 30 días después de que se use, se revoque o venza.",
        "Después de que aceptás, tu email queda en tu cuenta de organizador, porque lo usamos para reconocerte cuando entrás con Google.",
        "Cuando entrás con Google, recibimos y guardamos el identificador de tu cuenta de Google, tu email y tu nombre. No recibimos tu contraseña ni nada más de tu cuenta.",
        "Una cookie de sesión te mantiene conectado hasta 7 días. Las sesiones vencidas se eliminan.",
        "Tus eventos se guardan hasta que los borres. Cuando un evento se publica, su información es pública. Sos responsable de lo que publicás: no incluyas datos personales de otras personas sin su permiso.",
      ],
    },
    {
      heading: "Por qué podemos hacerlo",
      lines: ["Para darte el servicio que pediste, y por nuestro interés legítimo en mantenerlo seguro y libre de abusos."],
    },
    {
      heading: "Quién nos ayuda",
      lines: [
        "Cloudflare aloja Atlas. Nuestra base de datos está en la UE. Algunos registros técnicos pueden procesarse fuera de la UE, protegidos por el Marco de Privacidad de Datos UE–EE. UU. y cláusulas contractuales tipo.",
        "Como nuestro proveedor de hosting, Cloudflare registra datos básicos de cada solicitud (dirección IP, país aproximado, página solicitada y hora) en su analítica de tráfico. Podemos verlos durante hasta unos 30 días, solo para diagnosticar problemas y frenar abusos. También vemos estadísticas generales de tráfico, como las visitas por país, que no identifican a nadie.",
        "Google ofrece el inicio de sesión y es responsable de tu cuenta de Google según su propia política de privacidad.",
      ],
    },
    {
      heading: "Cuánto tiempo guardamos los datos",
      lines: [
        "Sesiones: 7 días, después se eliminan.",
        "Invitaciones: se borran 30 días después de que se usen, se revoquen o venzan.",
        "Registros técnicos: 3 días, solo con un identificador interno (sin email ni nombre).",
        "Registros de tráfico del hosting (dirección IP, país, página, hora): hasta unos 30 días, conservados por Cloudflare.",
        "Copias de seguridad de la base de datos: hasta 7 días. Lo que borres puede seguir en las copias hasta entonces.",
        "Tu cuenta: hasta que nos pidas borrarla.",
      ],
    },
    {
      heading: "Tus derechos",
      lines: [
        "Podés pedir ver, corregir, exportar o borrar tus datos, u oponerte a cómo los usamos. También podés reclamar ante la Agencia Española de Protección de Datos (AEPD, www.aepd.es).",
      ],
    },
    {
      heading: "Cookies y almacenamiento",
      lines: [
        "__Host-atlas_oauth: solo mientras iniciás sesión (10 minutos).",
        "__Host-atlas_session: te mantiene conectado (7 días).",
        "atlas.lang y atlas.schedule.zoom: tus elecciones de idioma y zoom, guardadas en tu navegador.",
        "Todas son estrictamente necesarias o se guardan solo cuando vos elegís, por eso no pedimos consentimiento.",
      ],
    },
    { heading: "Cambios", lines: ["Si este aviso cambia, actualizamos la fecha de arriba."] },
  ],
};

const da: PrivacyNotice = {
  title: "Privatlivspolitik",
  updatedLabel: "Sidst opdateret",
  sections: [
    {
      heading: "Hvem er ansvarlig",
      lines: ["Atlas-projektet er ansvarlig for dine data.", "Atlas er i en lukket test og er endnu ikke åbent for offentligheden. En kontaktadresse til anmodninger om privatliv vil blive offentliggjort her, før det åbner."],
    },
    {
      heading: "Hvis du besøger begivenhedskort",
      lines: [
        "Du behøver ikke en konto. Vi tilføjer ikke reklame- eller analyseværktøjer eller sporingscookies, og vi opbygger ikke profiler af besøgende.",
        "Din browser husker kun dit sprog og zoom i programmet, hvis du ændrer dem. Det bliver på din enhed.",
        "Din IP-adresse bruges i cirka et minut for at beskytte tjenesten mod misbrug (begrænsning af antal forespørgsler) og for at vise begivenheder tæt på dig først (omtrentlig placering ud fra din IP). Atlas gemmer den ikke selv.",
        'Hvis du trykker på "Føj til Google Kalender", modtager Google oplysningerne om den begivenhed.',
      ],
    },
    {
      heading: "Hvis du er arrangør eller er blevet inviteret",
      lines: [
        "Når du bliver inviteret, gemmer vi din e-mail for at kontrollere invitationen. Vi sletter invitationen 30 dage efter, at den er brugt, trukket tilbage eller udløbet.",
        "Når du har accepteret, bliver din e-mail liggende på din arrangørkonto, fordi vi bruger den til at genkende dig, når du logger ind med Google.",
        "Når du logger ind med Google, modtager og gemmer vi dit Google-konto-ID, din e-mail og dit navn. Vi får ikke din adgangskode eller andet fra din Google-konto.",
        "En sessionscookie holder dig logget ind i op til 7 dage. Udløbne sessioner fjernes.",
        "Dine begivenheder gemmes, indtil du sletter dem. Når en begivenhed er udgivet, er dens oplysninger offentlige. Du er ansvarlig for det, du udgiver: lad være med at medtage andres personoplysninger uden deres tilladelse.",
      ],
    },
    {
      heading: "Hvorfor vi må gøre det",
      lines: ["For at levere den tjeneste, du har bedt om, og af hensyn til vores legitime interesse i at holde den sikker og fri for misbrug."],
    },
    {
      heading: "Hvem hjælper os",
      lines: [
        "Cloudflare hoster Atlas. Vores database er gemt i EU. Nogle tekniske logge kan blive behandlet uden for EU, beskyttet af EU–USA-rammen for databeskyttelse og standardkontraktbestemmelser.",
        "Som vores hostingudbyder registrerer Cloudflare grundlæggende data om hver forespørgsel (IP-adresse, omtrentligt land, den ønskede side og tidspunkt) i sin trafikanalyse. Vi kan se dem i op til cirka 30 dage, kun for at finde fejl og stoppe misbrug. Vi ser også samlede trafikstatistikker, f.eks. besøg fordelt på lande, som ikke identificerer nogen.",
        "Google leverer login og er ansvarlig for din Google-konto i henhold til sin egen privatlivspolitik.",
      ],
    },
    {
      heading: "Hvor længe vi gemmer data",
      lines: [
        "Sessioner: 7 dage, derefter fjernes de.",
        "Invitationer: slettes 30 dage efter, at de er brugt, trukket tilbage eller udløbet.",
        "Tekniske logge: 3 dage, kun med et internt ID (ingen e-mail eller navn).",
        "Hostingens trafikregistreringer (IP-adresse, land, side, tidspunkt): op til cirka 30 dage, opbevaret af Cloudflare.",
        "Sikkerhedskopier af databasen: op til 7 dage. Data, du sletter, kan blive i sikkerhedskopierne indtil da.",
        "Din konto: indtil du beder os om at slette den.",
      ],
    },
    {
      heading: "Dine rettigheder",
      lines: [
        "Du kan bede om at se, rette, eksportere eller slette dine data eller gøre indsigelse mod, hvordan vi bruger dem. Du kan også klage til den spanske databeskyttelsesmyndighed (AEPD, www.aepd.es).",
      ],
    },
    {
      heading: "Cookies og lagring",
      lines: [
        "__Host-atlas_oauth: bruges kun, mens du logger ind (10 minutter).",
        "__Host-atlas_session: holder dig logget ind (7 dage).",
        "atlas.lang og atlas.schedule.zoom: dine valg af sprog og zoom, gemt i din browser.",
        "Alle er strengt nødvendige eller gemmes kun, når du vælger det, så vi beder ikke om samtykke.",
      ],
    },
    { heading: "Ændringer", lines: ["Hvis denne politik ændres, opdaterer vi datoen ovenfor."] },
  ],
};

export const PRIVACY_NOTICE: Record<Lang, PrivacyNotice> = { es, en, da };
