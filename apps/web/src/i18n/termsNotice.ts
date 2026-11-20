// Slice 32: the Terms of use text. Plain strings rendered by React (never as HTML).
// Spanish is the binding version (docs/slices/32-terms-draft-es.md); en, ca and da are faithful translations.
// "contact@leyenda.ink" and "/privacy" inside the text become fixed links (see pages/Terms.tsx).
import type { Lang } from "./messages";
import { termsCa } from "./ca/terms";

export type TermsSection = { heading: string; p?: string[]; ul?: string[] };
export type TermsNotice = { title: string; versionLabel: string; sections: TermsSection[] };

const es: TermsNotice = {
  title: "Términos de uso de leyenda.ink",
  versionLabel: "Versión",
  sections: [
    { heading: "1. Quiénes somos", p: ["leyenda.ink es un servicio gratuito de mapas interactivos para eventos. Lo opera Marco Sargiotti, a título personal y sin actividad comercial. Contacto: contact@leyenda.ink."] },
    { heading: "2. Aceptación", p: ["Al usar leyenda.ink aceptas estos términos. Si eres organizador, los aceptas de forma expresa al aceptar tu invitación. Si no estás de acuerdo, no uses el servicio."] },
    {
      heading: "3. El servicio",
      ul: [
        "Cualquier persona puede ver los mapas, puntos y programación de los eventos publicados, sin crear una cuenta.",
        "Los organizadores, con invitación, crean eventos y piden su publicación. leyenda.ink revisa cada evento antes de hacerlo público.",
        "Hoy el servicio es gratuito.",
      ],
    },
    {
      heading: "4. Cuentas de organizador",
      ul: [
        "Debes tener al menos 18 años.",
        "Entras con tu cuenta de Google. Eres responsable de lo que se haga desde tu cuenta.",
        "La información de tus eventos debe ser veraz.",
      ],
    },
    {
      heading: "5. Tu contenido",
      ul: [
        "Eres responsable del contenido que subes: textos, imágenes, mapas, horarios y enlaces.",
        "Garantizas que tienes los derechos necesarios sobre ese contenido.",
        "El contenido sigue siendo tuyo. Nos das una licencia gratuita, no exclusiva y mundial para alojarlo, adaptarlo de formato, mostrarlo y generar vistas previas para compartirlo, mientras esté publicado y durante el tiempo necesario para retirarlo.",
      ],
    },
    {
      heading: "6. Uso aceptable",
      p: ["No está permitido:"],
      ul: [
        "publicar contenido ilegal, engañoso, que incite al odio o a la violencia, o que infrinja derechos de otras personas;",
        "crear eventos falsos o que no existen;",
        "hacerse pasar por otra persona u organización;",
        "enviar spam, software malicioso o enlaces fraudulentos;",
        "intentar acceder sin permiso, sobrecargar el servicio, usarlo de forma automatizada abusiva o saltarse sus medidas de seguridad.",
      ],
    },
    {
      heading: "7. Moderación y cierre de cuentas",
      ul: [
        "Podemos rechazar, despublicar o eliminar contenido, y suspender o cerrar cuentas, si incumplen estos términos o la ley.",
        "Te avisaremos antes, salvo en casos graves (contenido ilegal, riesgo para personas, abuso del servicio) o cuando la ley lo impida.",
        "Puedes pedir el cierre de tu cuenta en cualquier momento escribiendo a contact@leyenda.ink.",
        "Si ves contenido que crees que infringe estos términos, escríbenos a contact@leyenda.ink con el enlace y el motivo.",
      ],
    },
    {
      heading: "8. Gratuidad y cambios",
      ul: [
        "El servicio es gratuito.",
        "Podemos cambiar estos términos o las condiciones del servicio, incluida la introducción de funciones de pago. Avisaremos de los cambios importantes con al menos 30 días de antelación en esta página y, si eres organizador, por email.",
        "Nada de lo que hoy es gratuito pasará a cobrarse sin ese aviso. Si no estás de acuerdo con un cambio, puedes dejar de usar el servicio.",
      ],
    },
    {
      heading: "9. Responsabilidad",
      ul: [
        'El servicio se ofrece "tal cual" y según disponibilidad. No garantizamos que funcione sin errores ni interrupciones.',
        "La información de cada evento la aportan sus organizadores. No respondemos de su exactitud ni de los eventos en sí (cancelaciones, cambios de horario, seguridad del lugar).",
        "Nuestra responsabilidad se limita en la medida en que la ley lo permite. Nada en estos términos excluye la responsabilidad por dolo, negligencia grave o cualquier otra que la ley no permita excluir.",
      ],
    },
    { heading: "10. Privacidad", p: ["Cómo tratamos los datos está explicado en la Política de privacidad (/privacy)."] },
    {
      heading: "11. Ley aplicable y tribunales",
      ul: [
        "Estos términos se rigen por la ley española. Los tribunales competentes son los de Barcelona.",
        "Si eres consumidor, conservas la protección de las normas imperativas de tu país de residencia y puedes acudir a los tribunales de tu domicilio (Reglamento (CE) 593/2008, Roma I, art. 6).",
        "Si eres consumidor en Argentina, conservas los derechos que te reconocen la Ley 24.240 de Defensa del Consumidor y las demás normas imperativas argentinas.",
      ],
    },
    { heading: "12. Idiomas", p: ["Estos términos están disponibles en español, inglés, catalán y danés. En caso de discrepancia, prevalece la versión en español."] },
    { heading: "13. Contacto", p: ["Para cualquier consulta o reclamo: contact@leyenda.ink."] },
  ],
};

const en: TermsNotice = {
  title: "leyenda.ink Terms of use",
  versionLabel: "Version",
  sections: [
    { heading: "1. Who we are", p: ["leyenda.ink is a free service for interactive event maps. It is operated by Marco Sargiotti, in a personal capacity and without commercial activity. Contact: contact@leyenda.ink."] },
    { heading: "2. Acceptance", p: ["By using leyenda.ink you accept these terms. If you are an organizer, you accept them expressly when you accept your invitation. If you do not agree, do not use the service."] },
    {
      heading: "3. The service",
      ul: [
        "Anyone can view the maps, points and schedules of published events, without creating an account.",
        "Organizers, by invitation, create events and request their publication. leyenda.ink reviews each event before making it public.",
        "Today the service is free.",
      ],
    },
    {
      heading: "4. Organizer accounts",
      ul: [
        "You must be at least 18 years old.",
        "You sign in with your Google account. You are responsible for whatever is done from your account.",
        "The information about your events must be truthful.",
      ],
    },
    {
      heading: "5. Your content",
      ul: [
        "You are responsible for the content you upload: texts, images, maps, schedules and links.",
        "You guarantee that you have the necessary rights over that content.",
        "The content remains yours. You give us a free, non-exclusive, worldwide licence to host it, adapt its format, display it and generate previews to share it, while it is published and for the time needed to remove it.",
      ],
    },
    {
      heading: "6. Acceptable use",
      p: ["The following is not allowed:"],
      ul: [
        "publishing content that is illegal, misleading, that incites hatred or violence, or that infringes the rights of other people;",
        "creating fake events or events that do not exist;",
        "impersonating another person or organization;",
        "sending spam, malicious software or fraudulent links;",
        "trying to gain access without permission, overloading the service, using it in an abusive automated way or bypassing its security measures.",
      ],
    },
    {
      heading: "7. Moderation and account closure",
      ul: [
        "We may reject, unpublish or remove content, and suspend or close accounts, if they breach these terms or the law.",
        "We will notify you beforehand, except in serious cases (illegal content, risk to people, abuse of the service) or where the law prevents it.",
        "You can ask to close your account at any time by writing to contact@leyenda.ink.",
        "If you see content that you believe breaches these terms, write to us at contact@leyenda.ink with the link and the reason.",
      ],
    },
    {
      heading: "8. Free of charge and changes",
      ul: [
        "The service is free.",
        "We may change these terms or the conditions of the service, including the introduction of paid features. We will announce important changes at least 30 days in advance on this page and, if you are an organizer, by email.",
        "Nothing that is free today will start to be charged for without that notice. If you do not agree with a change, you can stop using the service.",
      ],
    },
    {
      heading: "9. Liability",
      ul: [
        'The service is provided "as is" and as available. We do not guarantee that it will work without errors or interruptions.',
        "The information about each event is provided by its organizers. We are not responsible for its accuracy or for the events themselves (cancellations, schedule changes, safety of the venue).",
        "Our liability is limited to the extent the law allows. Nothing in these terms excludes liability for wilful misconduct, gross negligence or any other liability that the law does not allow to be excluded.",
      ],
    },
    { heading: "10. Privacy", p: ["How we handle data is explained in the Privacy notice (/privacy)."] },
    {
      heading: "11. Governing law and courts",
      ul: [
        "These terms are governed by Spanish law. The competent courts are those of Barcelona.",
        "If you are a consumer, you keep the protection of the mandatory rules of your country of residence and may go to the courts of your place of residence (Regulation (EC) 593/2008, Rome I, art. 6).",
        "If you are a consumer in Argentina, you keep the rights granted to you by Law 24.240 on Consumer Protection and other mandatory Argentine rules.",
      ],
    },
    { heading: "12. Languages", p: ["These terms are available in Spanish, English, Catalan and Danish. In case of discrepancy, the Spanish version prevails."] },
    { heading: "13. Contact", p: ["For any question or complaint: contact@leyenda.ink."] },
  ],
};

const da: TermsNotice = {
  title: "Vilkår for brug af leyenda.ink",
  versionLabel: "Version",
  sections: [
    { heading: "1. Hvem vi er", p: ["leyenda.ink er en gratis tjeneste med interaktive kort til events. Den drives af Marco Sargiotti, som privatperson og uden kommerciel aktivitet. Kontakt: contact@leyenda.ink."] },
    { heading: "2. Accept", p: ["Ved at bruge leyenda.ink accepterer du disse vilkår. Hvis du er arrangør, accepterer du dem udtrykkeligt, når du accepterer din invitation. Hvis du ikke er enig, må du ikke bruge tjenesten."] },
    {
      heading: "3. Tjenesten",
      ul: [
        "Enhver kan se kort, punkter og program for offentliggjorte events uden at oprette en konto.",
        "Arrangører opretter events efter invitation og anmoder om offentliggørelse. leyenda.ink gennemgår hvert event, før det bliver offentligt.",
        "I dag er tjenesten gratis.",
      ],
    },
    {
      heading: "4. Arrangørkonti",
      ul: [
        "Du skal være mindst 18 år.",
        "Du logger ind med din Google-konto. Du er ansvarlig for alt, der gøres fra din konto.",
        "Oplysningerne om dine events skal være sandfærdige.",
      ],
    },
    {
      heading: "5. Dit indhold",
      ul: [
        "Du er ansvarlig for det indhold, du uploader: tekster, billeder, kort, tidsplaner og links.",
        "Du garanterer, at du har de nødvendige rettigheder til indholdet.",
        "Indholdet forbliver dit. Du giver os en gratis, ikke-eksklusiv og verdensomspændende licens til at lagre det, tilpasse dets format, vise det og oprette forhåndsvisninger til deling, så længe det er offentliggjort og i den tid, der er nødvendig for at fjerne det.",
      ],
    },
    {
      heading: "6. Acceptabel brug",
      p: ["Følgende er ikke tilladt:"],
      ul: [
        "at offentliggøre indhold, der er ulovligt, vildledende, tilskynder til had eller vold eller krænker andres rettigheder;",
        "at oprette falske events eller events, der ikke findes;",
        "at udgive sig for at være en anden person eller organisation;",
        "at sende spam, skadelig software eller svigagtige links;",
        "at forsøge at få adgang uden tilladelse, overbelaste tjenesten, bruge den på en misbrugende automatiseret måde eller omgå dens sikkerhedsforanstaltninger.",
      ],
    },
    {
      heading: "7. Moderation og lukning af konti",
      ul: [
        "Vi kan afvise, afpublicere eller fjerne indhold og suspendere eller lukke konti, hvis de overtræder disse vilkår eller loven.",
        "Vi giver dig besked på forhånd, undtagen i alvorlige tilfælde (ulovligt indhold, risiko for personer, misbrug af tjenesten) eller hvor loven forhindrer det.",
        "Du kan til enhver tid bede om at få din konto lukket ved at skrive til contact@leyenda.ink.",
        "Hvis du ser indhold, som du mener overtræder disse vilkår, så skriv til os på contact@leyenda.ink med linket og begrundelsen.",
      ],
    },
    {
      heading: "8. Gratis og ændringer",
      ul: [
        "Tjenesten er gratis.",
        "Vi kan ændre disse vilkår eller tjenestens betingelser, herunder indføre betalingsfunktioner. Vi varsler vigtige ændringer med mindst 30 dages varsel på denne side og, hvis du er arrangør, pr. e-mail.",
        "Intet af det, der er gratis i dag, vil blive betalingsbelagt uden dette varsel. Hvis du ikke er enig i en ændring, kan du holde op med at bruge tjenesten.",
      ],
    },
    {
      heading: "9. Ansvar",
      ul: [
        'Tjenesten leveres "som den er" og efter tilgængelighed. Vi garanterer ikke, at den fungerer uden fejl eller afbrydelser.',
        "Oplysningerne om hvert event stammer fra arrangørerne. Vi hæfter ikke for deres rigtighed eller for selve eventene (aflysninger, ændringer i tidsplanen, sikkerheden på stedet).",
        "Vores ansvar er begrænset i det omfang, loven tillader det. Intet i disse vilkår udelukker ansvar for forsæt, grov uagtsomhed eller andet ansvar, som loven ikke tillader at udelukke.",
      ],
    },
    { heading: "10. Privatliv", p: ["Hvordan vi behandler data, er forklaret i privatlivspolitikken (/privacy)."] },
    {
      heading: "11. Gældende ret og domstole",
      ul: [
        "Disse vilkår er underlagt spansk ret. De kompetente domstole er dem i Barcelona.",
        "Hvis du er forbruger, bevarer du beskyttelsen efter de ufravigelige regler i dit bopælsland og kan indbringe sager for domstolene på dit bopælssted (forordning (EF) nr. 593/2008, Rom I, art. 6).",
        "Hvis du er forbruger i Argentina, bevarer du de rettigheder, der følger af lov nr. 24.240 om forbrugerbeskyttelse og de øvrige ufravigelige argentinske regler.",
      ],
    },
    { heading: "12. Sprog", p: ["Disse vilkår findes på spansk, engelsk, catalansk og dansk. Ved uoverensstemmelse gælder den spanske version."] },
    { heading: "13. Kontakt", p: ["Ved spørgsmål eller klager: contact@leyenda.ink."] },
  ],
};

export const TERMS_NOTICE: Record<Lang, TermsNotice> = { es, en, da, ca: termsCa };
