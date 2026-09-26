/**
 * AudioKing Categories Taxonomy
 * Authoritative category hierarchy for Pro Audio, Musical Instruments, and Home Audio.
 */
export const AUDIOKING_CATEGORIES = {
  proAudio: {
    id: 'pro-audio',
    name: 'Pro Audio',
    subtitle: 'Professional Studio Equipment',
    description: 'Studio & Live Sound Gear engineered for precision audio fidelity',
    subcategories: [
      {
        id: 'microphones',
        name: 'Microphones',
        hasChildren: true,
        children: [
          { id: 'condenser-mics', name: 'Condenser Microphones', filter: 'CONDENSER MICROPHONES' },
          { id: 'dynamic-mics', name: 'Dynamic Microphones', filter: 'DYNAMIC MICROPHONES' },
          { id: 'usb-mics', name: 'USB Microphones', filter: 'USB MICROPHONES' }
        ]
      },
      { id: 'audio-interfaces', name: 'Audio Interfaces', filter: 'AUDIO INTERFACES' },
      { id: 'pre-amps', name: 'Pre-Amps', filter: 'PRE AMPS & CHANNEL STRIPS' },
      { id: 'studio-headphones', name: 'Studio Headphones', filter: 'STUDIO HEADPHONES' },
      { id: 'monitor-speakers', name: 'Monitor Speakers', filter: 'STUDIO MONITORS' },
      { id: 'mixers', name: 'Mixers', filter: 'AUDIO MIXERS' },
      { id: 'dj-consoles', name: 'DJ Consoles', filter: 'DJ CONSOLES' },
      { id: 'speaker-systems', name: 'Speaker Systems', filter: 'SPEAKER SYSTEMS' },
      { id: 'guitar-pedals-effects', name: 'Guitar Pedals & Effects', filter: 'GUITAR PEDALS & EFFECTS' }
    ]
  },
  musicalInstruments: {
    id: 'musical-instruments',
    name: 'Musical Instruments',
    subtitle: 'Musical Instruments (Electronic)',
    description: 'Play. Create. Inspire with cutting-edge electronic and acoustic gear',
    subcategories: [
      { id: 'keyboards', name: 'Keyboards', filter: 'KEYBOARDS' },
      { id: 'midi-controllers', name: 'MIDI Controllers', filter: 'MIDI CONTROLLERS' },
      { id: 'e-drums', name: 'E-Drums', filter: 'ELECTRONIC DRUMS' },
      { id: 'digital-pianos', name: 'Digital Pianos', filter: 'DIGITAL PIANOS' },
      { id: 'audio-processors', name: 'Audio Processors', filter: 'PRE AMPS & CHANNEL STRIPS' }
    ]
  },
  homeAudio: {
    id: 'home-audio',
    name: 'Home Audio',
    subtitle: 'Sound for a Better Living',
    description: 'Audiophile grade home listening solutions',
    isComingSoon: true,
    badgeText: 'Launching Soon'
  }
};

/**
 * Quick Categories section - 10 active catalog categories with authentic product photos
 */
export const QUICK_CATEGORIES = [
  { id: 'qc-interfaces', name: 'Audio Interfaces', group: 'proAudio', image: 'assets/images/categories/cat-audio-interfaces-nobg.png', query: 'Audio Interfaces', filter: 'Audio Interfaces' },
  { id: 'qc-condenser-mics', name: 'Condenser Microphones', group: 'proAudio', image: 'assets/images/categories/cat-condenser-mics-nobg.png', query: 'Condenser Microphones', filter: 'Condenser Microphones' },
  { id: 'qc-dj-consoles', name: 'DJ Consoles', group: 'proAudio', image: 'assets/images/categories/cat-dj-consoles-nobg.png', query: 'DJ Consoles', filter: 'DJ Consoles' },
  { id: 'qc-drums', name: 'Electronic Drums', group: 'musicalInstruments', image: 'assets/images/categories/cat-electronic-drums-nobg.png', query: 'Electronic Drums', filter: 'Electronic Drums' },
  { id: 'qc-headphones', name: 'Headphones', group: 'proAudio', image: 'assets/images/categories/cat-headphones-nobg.png', query: 'Headphones', filter: 'Headphones' },
  { id: 'qc-midi', name: 'MIDI Controllers', group: 'musicalInstruments', image: 'assets/images/categories/cat-midi-controllers-nobg.png', query: 'MIDI Controllers', filter: 'MIDI Controllers' },
  { id: 'qc-mixers', name: 'Audio Mixers', group: 'proAudio', image: 'assets/images/categories/cat-audio-mixers-nobg.png', query: 'Audio Mixers', filter: 'Audio Mixers' },
  { id: 'qc-monitors', name: 'Monitor Speakers', group: 'proAudio', image: 'assets/images/categories/cat-monitor-speakers-nobg.png', query: 'Studio Monitors', filter: 'Studio Monitors' },
  { id: 'qc-preamps', name: 'Pre Amps', group: 'proAudio', image: 'assets/images/categories/cat-pre-amps-nobg.png', query: 'Preamps & Channel Strips', filter: 'Preamps & Channel Strips' },
  { id: 'qc-synths', name: 'Synthesizers', group: 'musicalInstruments', image: 'assets/images/categories/cat-synthesizers-nobg.png', query: 'Keyboards', filter: 'Keyboards' }
];

