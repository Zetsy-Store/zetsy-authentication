const User = require("../models/user"),
  bcrypt = require("bcrypt"),
  jwt = require("jsonwebtoken"),
  nodemailer = require("nodemailer"),
  crypto = require("crypto");

const sendVerificationMail = async (savedUser) => {
  const verificationToken = jwt.sign(
    { userId: savedUser._id },
    process.env.JWT_SECRET,
    {
      expiresIn: "1d",
    }
  );

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASSWORD,
      },
    });

    // @note verification might now work since, it's not on vercel
    const mailOptions = {
      from: "no-reply@zetsy.store", // replace with your email
      to: email,
      subject: "Verify your email",
      html: `<html>
        <head>
            <style>
                /* Add your custom styles here */
            </style>
        </head>
        <body>
            <div style="background-color: #f8f8f8; padding: 20px;">
                <h1>Welcome to Zetsy!</h1>
                <p>Thank you for registering with us. Please click the link below to verify your account:</p>
                <a href="https://api.zetsy.store/api/v1/auth/verify-email?token=${verificationToken}" style="background-color: #4CAF50; border: none; color: white; padding: 15px 32px; text-align: center; text-decoration: none; display: inline-block; font-size: 16px; margin: 4px 2px; cursor: pointer;">Verify Account</a>
                <p>If you did not sign up for this account, please ignore this email.</p>
            </div>
        </body>
    </html>`,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Verification email sent to ${email}`);
  } catch (error) {
    console.error(`Error sending verification email to ${email}: ${error}`);
  }
};

module.exports = {
  loginUser: async (req, res) => {
    const { email, password } = req.body;
    const { social } = req.query;
    const user = await User.findOne({ email });

    if (!user)
      return res.status(401).json({ message: "Email is not registered DB." });

    // @note If the user is not registered in the DB then
    // call an Register API with the new user email.

    if (!social) {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch)
        return res
          .status(401)
          .json({ message: "Incorrect email or password." });
    }

    const accessToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    const refreshToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ accessToken, refreshToken, user });
  },

  registerUser: async (req, res) => {
    try {
      const { email, password, picture } = req.body;
      const { social } = req.query;
      const existingUser = await User.findOne({ email });
      if (existingUser)
        return res.status(400).json({ message: "User already exists" });

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const newUser = new User({ email, password: hashedPassword, picture });

      const savedUser = await newUser.save();
      const accessToken = jwt.sign(
          { userId: savedUser._id },
          process.env.JWT_SECRET,
          {
            expiresIn: "1d",
          }
        );

        const refreshToken = jwt.sign(
          { userId: savedUser._id },
          process.env.JWT_REFRESH_SECRET,
          { expiresIn: "7d" }
        );

        res.status(200).json({ savedUser, accessToken, refreshToken });
        sendVerificationMail(savedUser);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  },

  forgotPassword: async (req, res) => {
    try {
      const { email } = req.body;

      var user = await User.findOne({ email });
      if (!user) return res.status(404).json({ message: "User not found" });

      const token = crypto.randomBytes(20).toString("hex");
      user.passwordResetToken = token;
      user.passwordResetExpires = Date.now() + 3600000; // Token expires in 1 hour

      await user.save();

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.NODEMAILER_EMAIL,
          pass: process.env.NODEMAILER_PASSWORD,
        },
      });

      const clientUrl =
        process.env.NODE_ENV === "development"
          ? "http://localhost:3000"
          : "https://app.zetsy.store";
      const mailOptions = {
        from: "Zetsy Store <no-reply@zetsy.store>",
        to: email,
        subject: "Password Reset Request",
        html: `
            <p>You have requested a password reset. Please click on the following link to reset your password:</p>
            <a href="${clientUrl}/reset-password/${token}">${clientUrl}/reset-password/${token}</a>
            <p>If you did not request this reset, please ignore this email and your password will remain unchanged.</p>
          `,
      };

      await transporter.sendMail(mailOptions);

      res.status(200).json({ message: "Password reset email sent!" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  },

  // @note resetPassword() can only be accessed after the forgot password request.
  // @note updateUser() must be used for logged in user to change password.
  resetPassword: async (req, res) => {
    try {
      const { token, password } = req.body;

      var user = await User.findOne({
        passwordResetToken: token,
        passwordResetExpires: { $gt: Date.now() },
      });

      if (!user)
        return res.status(400).json({ message: "Invalid or expired token" });

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      user.password = hashedPassword;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save();
      res.json({ message: "Password reset successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  },

  verifyUser: async (req, res) => {
    try {
      const { token } = req.query;

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await User.findById(decoded.userId);

      if (!user) return res.status(404).json({ message: "User not found" });

      await User.findByIdAndUpdate(decoded.userId, { verified: true });

      res.status(200).send("User verified successfully!");
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  },
};
