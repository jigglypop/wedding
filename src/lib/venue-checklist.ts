import type { Venue, VenueChecklist, VenueChecklistField, VenueHall } from '../types';

const genericHallFields = new Set(['capacity', 'rental', 'meal', 'hall']);
export function venueFieldScope(field:VenueChecklistField):'hall'|'venue' {
  if (field.scope) return field.scope;
  if (genericHallFields.has(field.id)) return 'hall';
  const comparison = field.id.match(/^compare-r(\d+)$/);
  if (comparison) { const row = Number(comparison[1]); return (row >= 7 && row <= 20) || (row >= 54 && row <= 58) ? 'hall' : 'venue'; }
  const onsite = field.id.match(/^onsite-r(\d+)$/);
  if (onsite) { const row = Number(onsite[1]); return (row >= 6 && row <= 9) || [12, 15, 17].includes(row) ? 'hall' : 'venue'; }
  return (field.kind === 'comparison' ? ['예식장', '홀 내부', '비용'] : ['홀', '신부대기실', '로비', '비용']).includes(field.category) ? 'hall' : 'venue';
}

export function scopeVenueChecklist(template:VenueChecklist):VenueChecklist {
  return { ...template, fields:template.fields.map(field => ({ ...field, scope:venueFieldScope(field) })) };
}

type LegacyVenue = Omit<Venue, 'halls'> & { halls?:VenueHall[] };
// Flat records become the first hall once; common and unrecognized records remain on the venue.
export function normalizeVenue(venue:LegacyVenue, fields:VenueChecklistField[] = []):Venue {
  if (Array.isArray(venue.halls)) return { ...venue, halls:venue.halls };
  const common:Venue['answers'] = {}; const hallAnswers:Venue['answers'] = {};
  const byId = new Map(fields.map(field => [field.id, field]));
  for (const [key, answer] of Object.entries(venue.answers)) {
    const field = byId.get(key) || { id:key, category:'', label:'', kind:key.startsWith('onsite-') ? 'onsite' as const : 'comparison' as const };
    (venueFieldScope(field) === 'hall' ? hallAnswers : common)[key] = answer;
  }
  return { ...venue, answers:common, halls:[{ id:`${venue.id.slice(0, 80)}-hall-1`, name:'홀 1', answers:hallAnswers }] };
}
