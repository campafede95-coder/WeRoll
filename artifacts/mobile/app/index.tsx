import React from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { ActivityIndicator, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export default function Index() {
  const colors = useColors();
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;
  return <Redirect href={(isSignedIn ? '/(tabs)' : '/(auth)/sign-in') as never} />;
}