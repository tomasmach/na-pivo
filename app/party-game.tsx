import React from 'react';
import { Redirect } from 'expo-router';
import PartyGameScreen from '@/party/PartyGameScreen';
import { GAMES_COMING_SOON } from '@/party/gameCatalog';

export default function PartyGameRoute() {
  if (GAMES_COMING_SOON) return <Redirect href="/(tabs)/beer" />;
  return <PartyGameScreen />;
}
