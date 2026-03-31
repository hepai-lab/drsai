import React from "react";
import UserProfileModal from "../../userProfile";

type ProfilePageProps = {
  user: { name?: string; email?: string };
  onClose: () => void;
};

const ProfilePage: React.FC<ProfilePageProps> = ({ user, onClose }) => {
  return (
    <div
      className="flex items-center justify-center h-full text-secondary"
    >
      <div className="text-center">
        <h2 className="text-base font-medium text-primary">{user.name}</h2>
        <p className="mt-2 text-sm opacity-60">{user.email}</p>
      </div>
    </div>
    // <UserProfileModal
    //   isVisible={true}
    //   onClose={onClose}
    //   user={user}
    // />
  );
};

export default ProfilePage;
