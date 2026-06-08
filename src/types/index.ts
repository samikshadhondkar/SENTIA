export interface Location {
  latitude: number;
  longitude: number;
}

export interface NavigationCommand {
  destination: string;
}

export interface NavigationInstruction {
  instruction: string;
}

export interface SOSData {
  location: Location;
  timestamp: string;
}
