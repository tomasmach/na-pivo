import React from 'react';
import { View } from 'react-native';
import Svg, { Line, Polygon } from 'react-native-svg';

import { t } from '@/i18n';

import { Icon } from '../../components/Icon';
import { D, T } from '../../components/ui';
import { C, s } from '../../theme';

const PAPER = C.white;

export function StickerJduNaPivo({ when }: { when: string }) {
  return (
    <View style={{ width: 218, padding: 22, paddingTop: 18, gap: 4, borderRadius: 26, backgroundColor: C.black, borderWidth: 6, borderColor: PAPER }}>
      <D s={56} lh={0.95}>
        {t.nv.sdileni.stickerJduNa}
      </D>
      <D s={86} lh={0.9} c={C.yellow} style={{ letterSpacing: -1 }}>
        {t.nv.sdileni.stickerPivo}
      </D>
      <View style={[s.row, { alignSelf: 'flex-start', minHeight: 30, borderRadius: 15, paddingHorizontal: 12, paddingVertical: 6, gap: 6, backgroundColor: C.line, marginTop: 6, maxWidth: 162 }]}>
        <Icon name="clock-4" size={14} color={C.yellow} />
        <T s={13} w={800} numberOfLines={2} style={{ flexShrink: 1 }}>
          {when}
        </T>
      </View>
      <T s={11} w={800} c="#FFFFFF80" style={{ letterSpacing: 1, marginTop: 6 }}>
        {t.nv.sdileni.stickerSite}
      </T>
    </View>
  );
}

export function StickerKdoJde({ where }: { where: string }) {
  return (
    <View style={[{ width: 220, height: 170, borderRadius: 110, backgroundColor: C.yellow, borderWidth: 6, borderColor: PAPER, transform: [{ rotate: '-6deg' }] }, s.center]}>
      <D s={44} c={C.black} lh={1}>
        {t.nv.sdileni.stickerKdoJde}
      </D>
      <D s={44} c={C.black} lh={1}>
        {t.nv.sdileni.stickerNaPivo}
      </D>
      <T s={13} w={800} c={C.black} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ marginTop: 6, maxWidth: 180 }}>
        {where}
      </T>
    </View>
  );
}

function Tally({ n }: { n: number }) {
  const strokes = Math.min(n, 4);
  return (
    <Svg width={60} height={64}>
      {Array.from({ length: strokes }, (_, i) => (
        <Line key={i} x1={10 + i * 12} y1={58} x2={14 + i * 12} y2={6} stroke={C.black} strokeWidth={6.5} strokeLinecap="round" />
      ))}
      {n >= 5 ? <Line x1={2} y1={44} x2={58} y2={18} stroke={C.black} strokeWidth={6} strokeLinecap="round" /> : null}
    </Svg>
  );
}

export function StickerTacek({ pub, count, since }: { pub: string; count: number; since: string }) {
  return (
    <View style={[{ width: 230, height: 230, borderRadius: 115, backgroundColor: PAPER, borderWidth: 6, borderColor: '#FFFFFF' }, s.center]}>
      <View style={{ position: 'absolute', width: 206, height: 206, borderRadius: 103, borderWidth: 3, borderColor: C.yellow }} />
      <View style={{ position: 'absolute', width: 190, height: 190, borderRadius: 95, borderWidth: 1, borderColor: '#0A0A0A1F' }} />
      <T s={12} w={800} c={C.black} numberOfLines={1} style={{ letterSpacing: 1.4, maxWidth: 160 }}>
        {pub.toUpperCase()}
      </T>
      <Tally n={count} />
      <D s={30} c={C.black}>
        {t.nv.sdileni.stickerCount(count)}
      </D>
      <T s={11} w={800} c="#0A0A0AA6" style={{ letterSpacing: 1.2 }}>
        {t.nv.sdileni.stickerSince(since)}
      </T>
    </View>
  );
}

export function StickerCedule({ pub, count, since }: { pub: string; count: number; since: string }) {
  return (
    <View style={{ width: 260, padding: 18, paddingHorizontal: 26, borderRadius: 22, backgroundColor: C.yellow, borderWidth: 6, borderColor: PAPER, transform: [{ rotate: '-3deg' }] }}>
      <View style={[{ borderWidth: 3, borderColor: C.black, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 8 }, s.center]}>
        <T s={12} w={800} c={C.black} style={{ letterSpacing: 2 }}>
          {t.nv.sdileni.stickerSitting}
        </T>
        <D s={60} c={C.black} lh={1} numberOfLines={1} adjustsFontSizeToFit>
          {pub.toUpperCase()}
        </D>
        <T s={11} w={800} c={C.black} style={{ letterSpacing: 1 }}>
          {`${t.nv.sdileni.stickerCount(count)} · ${t.nv.sdileni.stickerSince(since)}`}
        </T>
      </View>
    </View>
  );
}

export type ReceiptLine = { pub: string; count: number };

export function StickerUctenka({ date, lines, total, footer }: { date: string; lines: ReceiptLine[]; total: number; footer: string }) {
  return (
    <View style={{ width: 240 }}>
      <View style={{ backgroundColor: PAPER, borderTopLeftRadius: 8, borderTopRightRadius: 8, padding: 16, gap: 8 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <D s={18} c={C.black}>
            {t.nv.sdileni.stickerBrand}
          </D>
          <T s={11} w={700} c="#0A0A0A99">
            {date}
          </T>
        </View>
        {lines.map((line) => (
          <View key={line.pub} style={[s.row, { justifyContent: 'space-between', gap: 8 }]}>
            <T s={13} w={700} c={C.black} numberOfLines={1} style={s.fill}>
              {line.pub}
            </T>
            <D s={20} c={C.black}>
              {t.nv.sdileni.stickerTimes(line.count)}
            </D>
          </View>
        ))}
        <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
          <T s={11} w={800} c={C.black} style={{ letterSpacing: 1.4 }}>
            {t.nv.sdileni.stickerTotal}
          </T>
          <D s={46} c={C.black} lh={0.9}>
            {t.nv.sdileni.stickerCount(total)}
          </D>
        </View>
        <T s={11} w={700} c="#0A0A0A99">
          {footer}
        </T>
      </View>
      <Svg width={240} height={9}>
        <Polygon points={Array.from({ length: 21 }, (_, i) => `${i * 12},0 ${i * 12 + 6},9`).join(' ') + ' 240,0'} fill={PAPER} />
      </Svg>
    </View>
  );
}

export function StickerVelkeCislo({ count, label, route }: { count: number; label: string; route: string }) {
  return (
    <View style={{ width: 210, padding: 20, paddingTop: 14, borderRadius: 28, backgroundColor: C.black, borderWidth: 6, borderColor: PAPER, alignItems: 'center', gap: 4 }}>
      <View style={[s.row, { alignItems: 'flex-end', gap: 8 }]}>
        <D s={130} lh={0.85} c={C.yellow}>
          {String(count)}
        </D>
        <View style={{ paddingBottom: 6 }}>
          <D s={40} lh={0.9}>
            {t.nv.sdileni.stickerCountNoun(count)}
          </D>
          <D s={22} c="#FFFFFF80">
            {label}
          </D>
        </View>
      </View>
      <T s={13} w={800} numberOfLines={1}>
        {route}
      </T>
      <T s={10} w={800} c="#FFFFFF66" style={{ letterSpacing: 1 }}>
        {t.nv.sdileni.stickerSite}
      </T>
    </View>
  );
}
